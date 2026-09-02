import GLib from 'gi://GLib';

export const removeTimer = id => GLib.source_remove(id);

export function disposeAll(target, method, ...props) {
    for (const prop of props) {
        if (!target[prop])
            continue;
        try {
            target[prop][method]();
        } catch { /* already disposed, or the teardown method threw */ }
        target[prop] = null;
    }
}

export function clearIds(target, remover, ...props) {
    for (const prop of props) {
        if (!target[prop])
            continue;
        remover(target[prop]);
        target[prop] = 0;
    }
}

// The id lives on target[prop] so the owner's teardown can clear it like
// any other timer.
export function debounceTo(target, prop, delayMs, fn) {
    if (target[prop])
        GLib.source_remove(target[prop]);
    target[prop] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
        target[prop] = 0;
        fn();
        return GLib.SOURCE_REMOVE;
    });
}

export function disconnectSignal(target, source, prop) {
    if (!target[prop])
        return;
    try {
        source.disconnect(target[prop]);
    } catch { /* source already disposed */ }
    target[prop] = 0;
}

// Gio.DBusProxy wants 'disconnectSignal' rather than 'disconnect'.
export function disconnectAll(target, source, prop, method = 'disconnect') {
    const ids = target[prop];
    if (!Array.isArray(ids))
        return;
    for (const id of ids) {
        try {
            source[method](id);
        } catch {}
    }
    target[prop] = [];
}

// Returned rather than connected, so each owner keeps its own guard and
// id storage.
export function ruleDispatcher(rules) {
    return (_settings, key) => {
        for (const rule of rules) {
            if (rule.match(key))
                rule.run();
        }
    };
}

// GTK4 fires no `destroy` on a mere unparent, so a plain connect on a
// long-lived source would keep the widget alive for the whole process.
// A dialog emits only `closed`, hence the event.
export function connectScoped(target, source, signal, callback, event = null) {
    const id = source.connect_object(signal, callback, target, 0);
    if (event) {
        target.connect(event, () => {
            try {
                source.disconnect(id);
            } catch { /* already gone with the target */ }
        });
    }
    return id;
}
