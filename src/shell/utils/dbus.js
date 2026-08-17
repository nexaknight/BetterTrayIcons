import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readFileText, readProcFile, readEnviron} from '../../shared/fetch.js';
import {appImageStem, resolvePackaging, GENERIC_PROCESS_NAME_RE} from './packaging.js';
import {APP_ID_EXE_SUFFIX_RE, APPIMAGE_WRAPPERS} from './appId.js';

export const WINE_LAUNCHER_BINARIES = new Set([
    'wine', 'wine64',
    'wine-preloader', 'wine64-preloader',
    'wineserver', 'wineboot', 'winemenubuilder.exe',
]);

const SCRIPT_EXTENSION_RE = /\.(py|pyc|js|mjs|cjs|sh|pl|rb|lua|exe|asar)$/i;

// Entry-point names too many apps share to identify one, so the directory
// holding the script names the app instead. KDE does this for app.asar.
const SHARED_SCRIPT_BASENAMES = new Set([
    'main', 'app', 'run', 'start', 'index', '__main__', 'server', 'client', 'launcher',
]);

// Directories that hold scripts for everyone, so they name nobody.
const GENERIC_PATH_SEGMENTS = new Set([
    'bin', 'sbin', 'lib', 'lib64', 'libexec', 'share', 'local',
    'usr', 'opt', 'srv', 'var', 'tmp', 'home', 'resources', 'dist', 'build', 'src',
]);

// Separates the bus name from the object path in a tray item's address. D-Bus
// allows it in neither half, and gnome-shell-extension-appindicator publishes
// the same shape. Deliberately its own constant: this one is a wire format
// other processes read, APP_ID_SPLIT_SEPARATOR is our config key scheme.
const SNI_ITEM_ADDRESS_SEPARATOR = '@';

// Identifies one tray item, and is also what the watcher publishes. D-Bus
// already guarantees the pair is unique: bus names are handed out by the
// daemon, object paths are unique within a connection. Kept verbatim so it
// stays reversible, which is what lets a reader address the item back.
export function getItemAddress(busName, objectPath) {
    return `${busName}${SNI_ITEM_ADDRESS_SEPARATOR}${objectPath}`;
}

export function loadInterfaceXML(extensionDir, fileName) {
    const interfaceFile = extensionDir.get_child('interfaces').get_child(fileName);

    if (!interfaceFile.query_exists(null))
        throw new Error(`Interface file missing at ${interfaceFile.get_path()}`);

    // One-shot init read of a bundled XML file, never re-read at runtime.
    // Sync here so Gio.DBusProxy construction stays synchronous, otherwise
    // every caller would have to thread async chains through proxy creation.
    const [, contents] = interfaceFile.load_contents(null);
    return new TextDecoder('utf-8').decode(contents);
}

// A peer can put any D-Bus type behind a property the spec declares as 's'.
// Everything downstream does string work on these, so anything else is
// dropped here rather than throwing halfway through an icon update.
export async function refreshStringOnProxy(proxy, propertyName) {
    const value = await refreshPropertyOnProxy(proxy, propertyName);
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// cache: a pixmap variant is peer-sized and nothing reads it back from the
// proxy, so those callers opt out rather than parking it in shell memory
// for the app's lifetime.
export async function refreshPropertyOnProxy(proxy, propertyName, {cache = true} = {}) {
    try {
        const result = await proxy.get_connection().call(
            proxy.get_name(),
            proxy.get_object_path(),
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', [proxy.get_interface_name(), propertyName]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null
        );

        const [variant] = result.deep_unpack();
        const value = variant.deep_unpack();

        if (cache)
            proxy.set_cached_property(propertyName, variant);
        return value;
    } catch {
        return null;
    }
}

// The daemon answers under the same string as its name and interface.
export function callDBusDaemon(connection, method, params, replyType) {
    return connection.call(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus',
        method,
        params,
        replyType,
        Gio.DBusCallFlags.NONE,
        -1,
        null
    );
}

export async function getProcessInfo(proxy, busName) {
    try {
        const result = await callDBusDaemon(proxy.get_connection(),
            'GetConnectionUnixProcessID', new GLib.Variant('(s)', [busName]),
            new GLib.VariantType('(u)'));

        const [pid] = result.deep_unpack();
        if (!pid)
            return null;

        const cmdlinePath = `/proc/${pid}/cmdline`;
        const fCmd = Gio.File.new_for_path(cmdlinePath);

        try {
            const raw = await readFileText(fCmd);
            const parts = _cmdlineParts(raw);
            const flat = parts.join(' ').trim();

            // Flatpak's sandbox launcher and dbus proxy own the bus name but aren't the app.
            // They still sit in the app's scope, so which flatpak it is survives.
            if (flat.includes('xdg-dbus-proxy') || flat.includes('bwrap')) {
                const packaging = await resolvePackaging({pid});
                return packaging ? {packaging} : null;
            }

            // A zombie keeps a readable, empty cmdline. comm still names it.
            if (parts.length === 0)
                return _commIdentity(pid);

            const rawBin = parts[0].split('/').pop().toLowerCase();
            if (!rawBin || rawBin.startsWith('.'))
                return null;

            const exeName = _extractWineExeName(parts);
            // What the previous release keyed this app under. It resolved
            // nothing, so an interpreter or AppImage wrapper named the app.
            // The migration needs the real old key, not a reconstruction of it.
            const legacyName = exeName || rawBin;

            // AppRun.wrapped is appimage-builder's launcher convention, the same
            // name for every app packaged with it. Without the real name from
            // the APPIMAGE env those apps collide on one id and lose their config.
            if (APPIMAGE_WRAPPERS.has(rawBin)) {
                const appImageName = await _readAppImageName(pid);
                if (!appImageName)
                    return null;
                return {
                    name: appImageName, isWine: false, pid, legacyName,
                    packaging: await resolvePackaging({pid, appImageName}),
                };
            }

            const packaging = await resolvePackaging({pid, binaryPath: parts[0]});

            // An interpreter names the runtime, not the app. The script
            // argument carries the real name, e.g. /usr/bin/solaar for
            // python3, and covers `python3 -m solaar` via the -m value.
            if (GENERIC_PROCESS_NAME_RE.test(rawBin)) {
                const script = parts.slice(1).find(p => p && !p.startsWith('-'));
                const scriptName = _scriptIdentity(script);
                return scriptName
                    ? {name: scriptName, isWine: false, pid, legacyName, packaging}
                    : {pid, legacyName, packaging};
            }

            const isWine = WINE_LAUNCHER_BINARIES.has(rawBin) || !!exeName;

            if (isWine) {
                return {
                    name: legacyName,
                    isWine: true,
                    pid,
                    legacyName,
                    packaging,
                };
            }

            return {name: rawBin, isWine: false, pid, legacyName, packaging};
        } catch { /* /proc/PID/cmdline unreadable */ }

        return await _commIdentity(pid);
    } catch {
        return null;
    }
}

async function _commIdentity(pid) {
    const comm = await readProcFile(pid, 'comm');
    if (!comm)
        return null;
    const name = comm.trim().toLowerCase();
    if (name === 'xdg-dbus-proxy' || name === 'bwrap')
        return null;
    const isWine = WINE_LAUNCHER_BINARIES.has(name);
    // The previous release read comm the same way, so the old key
    // matches the new one on this path.
    return {
        name, isWine, pid, legacyName: name,
        packaging: await resolvePackaging({pid}),
    };
}

// Some apps leave cmdline as one space-joined blob instead of NUL-separated
// fields, which would make the binary path come out as the whole command line.
function _cmdlineParts(raw) {
    const fields = raw.split('\0').filter(p => p.length > 0);
    return fields.length === 1 ? fields[0].split(/\s+/).filter(Boolean) : fields;
}

function _scriptIdentity(script) {
    if (!script)
        return null;

    const segments = script.split('/').filter(Boolean);
    const base = segments.pop()?.replace(SCRIPT_EXTENSION_RE, '');
    if (!base || GENERIC_PROCESS_NAME_RE.test(base))
        return null;

    if (!SHARED_SCRIPT_BASENAMES.has(base.toLowerCase()))
        return base;

    const parent = segments.pop();
    return parent && !GENERIC_PATH_SEGMENTS.has(parent.toLowerCase()) ? parent : null;
}

async function _readAppImageName(pid) {
    try {
        const appImage = (await readEnviron(pid)).get('APPIMAGE');
        return appImage ? appImageStem(appImage) : null;
    } catch {
        return null;
    }
}

function _extractWineExeName(cmdlineParts) {
    for (const part of cmdlineParts) {
        if (!part || !part.toLowerCase().endsWith('.exe'))
            continue;
        const stem = part.replace(/\\/g, '/').split('/').pop().replace(APP_ID_EXE_SUFFIX_RE, '');
        if (stem)
            return stem.toLowerCase();
    }
    return null;
}

