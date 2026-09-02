import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readFileText, readProcFile, readEnviron} from '../../shared/asyncIo.js';
import {appImageStem, resolvePackaging, GENERIC_PROCESS_NAME_RE} from './packaging.js';
import {APP_ID_EXE_SUFFIX_RE, APPIMAGE_WRAPPERS} from './appId.js';
import {callDBusDaemon} from '../dbusCalls.js';

export const WINE_LAUNCHER_BINARIES = new Set([
    'wine', 'wine64',
    'wine-preloader', 'wine64-preloader',
    'wineserver', 'wineboot', 'winemenubuilder.exe',
]);

const SCRIPT_EXTENSION_RE = /\.(py|pyc|js|mjs|cjs|sh|pl|rb|lua|exe|asar)$/i;

// Entry-point names too many apps share to identify one, so the directory
// holding the script names the app instead.
const SHARED_SCRIPT_BASENAMES = new Set([
    'main', 'app', 'run', 'start', 'index', '__main__', 'server', 'client', 'launcher',
]);

const GENERIC_PATH_SEGMENTS = new Set([
    'bin', 'sbin', 'lib', 'lib64', 'libexec', 'share', 'local',
    'usr', 'opt', 'srv', 'var', 'tmp', 'home', 'resources', 'dist', 'build', 'src',
]);

// Flatpak's sandbox launcher and dbus proxy own the bus name but aren't the app.
const FLATPAK_HELPER_BINARIES = ['xdg-dbus-proxy', 'bwrap'];

export async function getProcessInfo(proxy, busName) {
    try {
        const result = await callDBusDaemon(proxy.get_connection(),
            'GetConnectionUnixProcessID', new GLib.Variant('(s)', [busName]),
            new GLib.VariantType('(u)'));

        const [pid] = result.deep_unpack();
        if (!pid)
            return null;

        const cmdlineFile = Gio.File.new_for_path(`/proc/${pid}/cmdline`);

        try {
            return await _identityFromCmdline(pid, cmdlineFile);
        } catch { /* /proc/PID/cmdline unreadable */ }

        return await _commIdentity(pid);
    } catch {
        return null;
    }
}

async function _identityFromCmdline(pid, cmdlineFile) {
    const raw = await readFileText(cmdlineFile);
    const parts = _cmdlineParts(raw);
    const flat = parts.join(' ').trim();

    // The helper still sits in the app's scope, so which flatpak it is survives.
    if (FLATPAK_HELPER_BINARIES.some(binary => flat.includes(binary))) {
        const packaging = await resolvePackaging({pid});
        return packaging ? {packaging} : null;
    }

    // A zombie keeps a readable, empty cmdline. comm still names it.
    if (parts.length === 0)
        return _commIdentity(pid);

    const rawBinary = parts[0].split('/').pop().toLowerCase();
    if (!rawBinary || rawBinary.startsWith('.'))
        return null;

    const exeName = _extractWineExeName(parts);
    // The migration needs the real old key, not a reconstruction of it.
    const legacyName = exeName || rawBinary;

    if (APPIMAGE_WRAPPERS.has(rawBinary)) {
        const appImageName = await _readAppImageName(pid);
        if (!appImageName)
            return null;
        return {
            name: appImageName, isWine: false, pid, legacyName,
            packaging: await resolvePackaging({pid, appImageName}),
        };
    }

    const packaging = await resolvePackaging({pid, binaryPath: parts[0]});

    if (GENERIC_PROCESS_NAME_RE.test(rawBinary)) {
        const script = parts.slice(1).find(p => !p.startsWith('-'));
        const scriptName = _scriptIdentity(script);
        return scriptName
            ? {name: scriptName, isWine: false, pid, legacyName, packaging}
            : {pid, legacyName, packaging};
    }

    if (WINE_LAUNCHER_BINARIES.has(rawBinary) || exeName)
        return {name: legacyName, isWine: true, pid, legacyName, packaging};

    return {name: rawBinary, isWine: false, pid, legacyName, packaging};
}

async function _commIdentity(pid) {
    const comm = await readProcFile(pid, 'comm');
    if (!comm)
        return null;
    const name = comm.trim().toLowerCase();
    if (FLATPAK_HELPER_BINARIES.includes(name))
        return null;
    const isWine = WINE_LAUNCHER_BINARIES.has(name);
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
    const appImage = (await readEnviron(pid)).get('APPIMAGE');
    return appImage ? appImageStem(appImage) : null;
}

function _extractWineExeName(cmdlineParts) {
    for (const part of cmdlineParts) {
        if (!part.toLowerCase().endsWith('.exe'))
            continue;
        const stem = part.replace(/\\/g, '/').split('/').pop().replace(APP_ID_EXE_SUFFIX_RE, '');
        if (stem)
            return stem.toLowerCase();
    }
    return null;
}
