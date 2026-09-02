import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readFileText} from '../shared/asyncIo.js';

// Separates the bus name from the object path in a tray item's address, D-Bus
// allows it in neither half. Kept apart from APP_ID_SPLIT_SEPARATOR because
// this one is a wire format other processes read.
const SNI_ITEM_ADDRESS_SEPARATOR = '@';

export function getItemAddress(busName, objectPath) {
    return `${busName}${SNI_ITEM_ADDRESS_SEPARATOR}${objectPath}`;
}

const INTERFACE_FILES = Object.freeze({
    item: 'StatusNotifierItem.xml',
    watcher: 'StatusNotifierWatcher.xml',
    menu: 'DBusMenu.xml',
});

export async function loadInterfaces(extensionDir) {
    const dir = extensionDir.get_child('interfaces');
    const entries = await Promise.all(Object.entries(INTERFACE_FILES).map(
        async ([key, name]) => [key, await readFileText(dir.get_child(name))]));
    return Object.fromEntries(entries);
}

// A peer can put any D-Bus type behind a property the spec declares as 's', so
// anything else is dropped here rather than throwing mid icon update.
export async function refreshStringOnProxy(proxy, propertyName) {
    const value = await refreshPropertyOnProxy(proxy, propertyName);
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// Callers reading a pixmap opt out of the cache, a peer-sized variant would
// otherwise sit in shell memory for the app's lifetime.
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
