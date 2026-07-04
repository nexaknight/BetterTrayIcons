import GLib from 'gi://GLib';

export const removeTimer = id => GLib.source_remove(id);

export function disposeAll(target, method, ...props) {
    for (const prop of props) {
        if (target[prop]) {
            target[prop][method]();
            target[prop] = null;
        }
    }
}

// For timeout or signal ids.
export function clearIds(target, remover, ...props) {
    for (const prop of props) {
        if (target[prop]) {
            remover(target[prop]);
            target[prop] = 0;
        }
    }
}

// `method` defaults to 'disconnect'. Gio.DBusProxy uses 'disconnectSignal'.
export function disconnectSignal(target, source, prop, method = 'disconnect') {
    if (target[prop]) {
        try {
            source[method](target[prop]);
        } catch { /* source already disposed */ }
        target[prop] = 0;
    }
}

// Per-id try/catch so a half-disposed source still releases the rest.
export function disconnectAll(target, source, prop, method = 'disconnect') {
    const ids = target[prop];
    if (!Array.isArray(ids))
        return;
    for (const id of ids) {
        try {
            source[method](id);
        } catch { /* source disposed mid-loop */ }
    }
    target[prop] = [];
}

// connect + auto-disconnect when target fires `event`. Used in prefs to
// tie a settings handler to a widget so it can't outlive the page.
export function connectScoped(target, source, signal, callback, event = 'destroy') {
    const id = source.connect(signal, callback);
    target.connect(event, () => {
        try {
            source.disconnect(id);
        } catch { /* source disposed */ }
    });
    return id;
}
