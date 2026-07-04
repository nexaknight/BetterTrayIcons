import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readFileBytes} from '../../shared/fetch.js';
import {WINE_LAUNCHER_BINARIES} from '../../const.js';

export function getUniqueId(busName, objectPath) {
    const safeBusName = busName ? busName.replace(/[:.]/g, '_') : 'unknown';
    const safePath = objectPath ? objectPath.replace(/\//g, '_') : 'unknown';
    return `${safeBusName}${safePath}`;
}

export function loadInterfaceXML(extensionDir, fileName) {
    const interfaceFile = extensionDir.get_child('interfaces').get_child(fileName);

    if (!interfaceFile.query_exists(null))
        throw new Error(`Interface file missing at ${interfaceFile.get_path()}`);

    // One-shot init read of a bundled XML file, never re-read at runtime.
    // Sync here so Gio.DBusProxy construction stays synchronous, otherwise
    // every caller would have to thread async chains through proxy creation.
    const [success, contents] = interfaceFile.load_contents(null);
    if (!success || !contents)
        throw new Error(`Failed to read content of ${fileName}`);

    return new TextDecoder('utf-8').decode(contents);
}

export async function refreshPropertyOnProxy(proxy, propertyName) {
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

        proxy.set_cached_property(propertyName, variant);
        return value;
    } catch {
        return null;
    }
}

export async function getProcessInfo(proxy, busName) {
    try {
        const connection = proxy.get_connection();
        const result = await connection.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'GetConnectionUnixProcessID',
            new GLib.Variant('(s)', [busName]),
            new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null
        );

        const [pid] = result.deep_unpack();
        if (!pid)
            return null;

        const cmdlinePath = `/proc/${pid}/cmdline`;
        const fCmd = Gio.File.new_for_path(cmdlinePath);

        try {
            const content = await readFileBytes(fCmd);
            if (content) {
                const dec = new TextDecoder('utf-8');
                const raw = dec.decode(content);
                const parts = raw.split('\0').filter(p => p.length > 0);
                const flat = parts.join(' ').trim();

                // Flatpak's sandbox launcher and dbus proxy own the bus name but aren't the app.
                if (flat.includes('xdg-dbus-proxy') || flat.includes('bwrap'))
                    return null;

                if (parts.length === 0)
                    return null;

                const rawBin = parts[0].split('/').pop().toLowerCase();
                if (!rawBin || rawBin.startsWith('.'))
                    return null;

                const exeName = _extractWineExeName(parts);
                const launcherIsWine = WINE_LAUNCHER_BINARIES.has(rawBin);
                const isWine = launcherIsWine || !!exeName;

                if (isWine) {
                    return {
                        name: exeName || rawBin,
                        isWine: true,
                        exeName,
                    };
                }

                return {name: rawBin, isWine: false, exeName: null};
            }
        } catch { /* /proc/PID/cmdline unreadable */ }

        try {
            const file = Gio.File.new_for_path(`/proc/${pid}/comm`);
            const c2 = await readFileBytes(file);
            if (c2) {
                const dec = new TextDecoder('utf-8');
                const name = dec.decode(c2).trim().toLowerCase();
                if (name === 'xdg-dbus-proxy' || name === 'bwrap')
                    return null;
                const isWine = WINE_LAUNCHER_BINARIES.has(name);
                return {name, isWine, exeName: null};
            }
        } catch { /* /proc/PID/comm unreadable */ }
    } catch {
        return null;
    }
    return null;
}

function _extractWineExeName(cmdlineParts) {
    for (const part of cmdlineParts) {
        if (!part || !part.toLowerCase().endsWith('.exe'))
            continue;
        const stem = part.replace(/\\/g, '/').split('/').pop().replace(/\.exe$/i, '');
        if (stem)
            return stem.toLowerCase();
    }
    return null;
}

