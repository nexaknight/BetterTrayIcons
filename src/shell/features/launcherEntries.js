import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {callDBusDaemon} from '../dbusCalls.js';

// SNI has no unread-count property, apps bake the number into their icon pixmap.
const LAUNCHER_ENTRY_IFACE = 'com.canonical.Unity.LauncherEntry';

const APP_URI_PREFIX = 'application://';

const FLATPAK_APP_ID_PREFIX = 'flatpak-';

const PID_TARGET_PREFIX = 'pid:';
const _pidTarget = pid => `${PID_TARGET_PREFIX}${pid}`;

// A second digit no longer fits the badge at panel icon sizes.
const UNREAD_BADGE_MAX = 9;

// Launchers and apps disagree on desktop-id casing, so every desktop-id key
// here is stored and compared lowercase.
const _entries = new Map();
const _senders = new Map();
const _listeners = new Map();

let _subscriptionId = 0;

export function enableLauncherEntries() {
    if (_subscriptionId)
        return;
    _subscriptionId = Gio.DBus.session.signal_subscribe(
        null, LAUNCHER_ENTRY_IFACE, 'Update', null, null,
        Gio.DBusSignalFlags.NONE,
        (_conn, sender, _path, _iface, _signal, params) => _onUpdate(sender, params));
}

export function disableLauncherEntries() {
    if (_subscriptionId) {
        Gio.DBus.session.signal_unsubscribe(_subscriptionId);
        _subscriptionId = 0;
    }
    for (const {watchId} of _senders.values())
        Gio.bus_unwatch_name(watchId);
    _senders.clear();
    _entries.clear();
    _listeners.clear();
}

export function unreadBadge(targets) {
    const count = _unreadCountFor(targets);
    if (count === null)
        return null;
    return {text: count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count)};
}

function _unreadCountFor(targets) {
    for (const target of targets) {
        const entry = _entries.get(target);
        if (entry && entry.visible && entry.count > 0)
            return entry.count;
    }
    return null;
}

// The desktop id needs a mapped window and a tray-parked chat app has none, so
// outside a flatpak the emitting process closes that gap.
export function unreadTargets({pid = null, appId = null, packagingKind = null} = {}) {
    const out = new Set();
    if (pid)
        out.add(_pidTarget(pid));
    const tracked = _appFromPid(pid)?.get_id();
    if (tracked)
        out.add(tracked.toLowerCase());
    const desktopId = _flatpakDesktopId(appId, packagingKind);
    if (desktopId)
        out.add(desktopId);
    return [...out];
}

function _appFromPid(pid) {
    return pid ? Shell.WindowTracker.get_default().get_app_from_pid(pid) : null;
}

function _flatpakDesktopId(appId, packagingKind) {
    return packagingKind === 'flatpak' && appId?.startsWith(FLATPAK_APP_ID_PREFIX)
        ? `${appId.slice(FLATPAK_APP_ID_PREFIX.length)}.desktop`
        : null;
}

export function addUnreadListener(targets, callback) {
    if (targets.length === 0)
        return null;
    for (const key of targets) {
        let set = _listeners.get(key);
        if (!set)
            _listeners.set(key, set = new Set());
        set.add(callback);
    }
    return () => {
        for (const key of targets) {
            const set = _listeners.get(key);
            set?.delete(callback);
            if (set?.size === 0)
                _listeners.delete(key);
        }
    };
}

function _onUpdate(sender, params) {
    // The subscription matches on name alone, so a peer can serve any
    // signature and its values are its own to choose.
    const [appUri, props] = params.deep_unpack();
    if (typeof appUri !== 'string' || !appUri.startsWith(APP_URI_PREFIX))
        return;
    if (!props || typeof props !== 'object')
        return;
    const desktopId = appUri.slice(APP_URI_PREFIX.length).toLowerCase();

    const entry = _entries.get(desktopId) ?? {count: 0, visible: false};
    const prevCount = entry.count;
    const prevVisible = entry.visible;
    if (props['count'] instanceof GLib.Variant)
        entry.count = Number(props['count'].deep_unpack());
    if (props['count-visible'] instanceof GLib.Variant)
        entry.visible = !!props['count-visible'].deep_unpack();
    // Latest emitter owns the entry, so an old instance dying right after a
    // restart cannot wipe what the new one just published.
    entry.sender = sender;
    _entries.set(desktopId, entry);

    const pidTarget = _linkPid(_watchSender(sender, desktopId), entry);

    // Electron re-emits Update per progress tick, and every callback here is
    // a full icon resolve.
    if (entry.count === prevCount && entry.visible === prevVisible)
        return;
    _fire(desktopId);
    _fire(pidTarget);
}

// A killed app never retracts its entry, so the count would stick on the
// badge forever.
function _watchSender(sender, desktopId) {
    let record = _senders.get(sender);
    if (!record) {
        record = {targets: new Set(), watchId: 0, pid: null};
        _senders.set(sender, record);
        record.watchId = Gio.bus_watch_name(Gio.BusType.SESSION, sender,
            Gio.BusNameWatcherFlags.NONE, null, () => _dropSender(sender));
        _lookupSenderPid(sender, record);
    }
    record.targets.add(desktopId);
    return record;
}

// The bus answers with the pid only after a round trip, so the first emission
// of a freshly seen sender has to reach its listeners once the answer lands.
async function _lookupSenderPid(sender, record) {
    let pid = null;
    try {
        [pid] = (await callDBusDaemon(Gio.DBus.session, 'GetConnectionUnixProcessID',
            new GLib.Variant('(s)', [sender]),
            new GLib.VariantType('(u)'))).deep_unpack();
    } catch {
        return;
    }
    if (!pid || _senders.get(sender) !== record)
        return;

    const pending = [...record.targets].map(target => _entries.get(target));
    record.pid = pid;
    for (const entry of pending) {
        if (entry)
            _fire(_linkPid(record, entry));
    }
}

function _linkPid(record, entry) {
    if (!record.pid)
        return null;
    const target = _pidTarget(record.pid);
    record.targets.add(target);
    _entries.set(target, entry);
    return target;
}

function _fire(target) {
    for (const callback of _listeners.get(target) ?? [])
        callback();
}

function _dropSender(sender) {
    const record = _senders.get(sender);
    if (!record)
        return;
    Gio.bus_unwatch_name(record.watchId);
    _senders.delete(sender);
    for (const target of record.targets) {
        if (_entries.get(target)?.sender !== sender)
            continue;
        _entries.delete(target);
        _fire(target);
    }
}
