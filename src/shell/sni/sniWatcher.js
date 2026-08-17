import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn, error} from '../../shared/logging.js';
import {clearIds, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {loadInterfaceXML, getItemAddress, callDBusDaemon} from '../utils/dbus.js';
import {TrayIcon} from './trayIcon.js';
import {forwardDragStateToIndicator} from '../features/dragAndDrop.js';

const INITIAL_SCAN_DELAY_MS = 500;

export class SniWatcher {
    constructor(extensionDir, indicator, settings) {
        this._extensionDir = extensionDir;
        this._indicator = indicator;
        this._settings = settings;

        this._items = new Map();
        this._pending = new Map();
        this._dbusImpl = null;

        this._kdeWatcherId = 0;
        this._freedesktopWatcherId = 0;
        this._nameWatchers = new Map();
        this._disabled = false;

        // Both bus names trigger a scan when owned. Run it once.
        this._scanTimeoutId = 0;
        this._hasScanned = false;

        try {
            const itemXml = loadInterfaceXML(this._extensionDir, 'StatusNotifierItem.xml');
            this._itemProxyClass = Gio.DBusProxy.makeProxyWrapper(itemXml);
        } catch (e) {
            error('SniWatcher: Failed to load StatusNotifierItem.xml', e);
        }
    }

    enable() {
        this._disabled = false;
        try {
            const xmlContent = loadInterfaceXML(this._extensionDir, 'StatusNotifierWatcher.xml');
            const nodeInfo = Gio.DBusNodeInfo.new_for_xml(xmlContent);
            const interfaceInfo = nodeInfo.lookup_interface('org.kde.StatusNotifierWatcher');

            this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(interfaceInfo, this);
            this._dbusImpl.export(Gio.DBus.session, '/StatusNotifierWatcher');

            this._hasScanned = false;

            const onOwned = () => {
                this._scheduleInitialScan();
            };

            const onLost = name => {
                warn(`SniWatcher: Failed to own ${name} (Bus contention or already running?)`);
            };

            // DO_NOT_QUEUE makes a second instance exit via onLost instead
            // of waiting in the bus queue. REPLACE is omitted, it only takes
            // the name from owners that opted in via ALLOW_REPLACEMENT.
            const ownFlags = Gio.BusNameOwnerFlags.DO_NOT_QUEUE;

            this._kdeWatcherId = Gio.bus_own_name(
                Gio.BusType.SESSION,
                'org.kde.StatusNotifierWatcher',
                ownFlags,
                null,
                onOwned,
                () => onLost('org.kde.StatusNotifierWatcher')
            );

            this._freedesktopWatcherId = Gio.bus_own_name(
                Gio.BusType.SESSION,
                'org.freedesktop.StatusNotifierWatcher',
                ownFlags,
                null,
                onOwned,
                () => onLost('org.freedesktop.StatusNotifierWatcher')
            );
        } catch (e) {
            error('SniWatcher: Failed to enable', e);
            this.disable();
        }
    }

    // One watch per item name instead of a global NameOwnerChanged
    // subscription. The daemon filters per match rule, so the shell only
    // wakes for names it actually tracks.
    _watchName(id, busName) {
        if (this._nameWatchers.has(id) || busName.startsWith('/'))
            return;
        this._nameWatchers.set(id, Gio.bus_watch_name(
            Gio.BusType.SESSION,
            busName,
            Gio.BusNameWatcherFlags.NONE,
            null,
            () => this._onNameVanished(busName)
        ));
    }

    _unwatchName(id) {
        const watcherId = this._nameWatchers.get(id);
        if (watcherId) {
            Gio.bus_unwatch_name(watcherId);
            this._nameWatchers.delete(id);
        }
    }

    _onNameVanished(name) {
        // Iterate over a snapshot so destroy() can mutate the map.
        for (const item of Array.from(this._items.values())) {
            if (item.busName === name)
                item.destroy();
        }

        for (const [id, pendingBusName] of Array.from(this._pending)) {
            if (pendingBusName === name) {
                this._pending.delete(id);
                this._unwatchName(id);
            }
        }
    }

    _scheduleInitialScan() {
        if (this._hasScanned)
            return;
        this._hasScanned = true;

        // Delay the scan to let name ownership propagate. Clients register
        // their items only after they see the watcher appear on the bus.
        this._scanTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INITIAL_SCAN_DELAY_MS, () => {
            this._initialScan();
            this._scanTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    async _initialScan() {
        try {
            const result = await callDBusDaemon(Gio.DBus.session,
                'ListNames', null, new GLib.VariantType('(as)'));

            const [names] = result.deep_unpack();

            for (const name of names) {
                // Accept both prefixes: KDE's KStatusNotifierItem registers
                // org.kde.StatusNotifierItem-PID-ID, Chromium and Electron use
                // the freedesktop variant when they claim a well-known name at all.
                if (name.startsWith('org.kde.StatusNotifierItem') ||
                    name.startsWith('org.freedesktop.StatusNotifierItem'))
                    this._registerItem(name, '/StatusNotifierItem');
            }
        } catch (e) {
            warn(`SniWatcher: Initial scan failed: ${e.message}`);
        }
    }

    async RegisterStatusNotifierItemAsync(params, invocation) {
        const service = params[0];
        const sender = invocation.get_sender();

        // libappindicator and Ayatana clients pass an object path here, like
        // /org/ayatana/NotificationItem/..., KDE clients pass their bus name.
        let busName = sender || service;
        let objectPath = '/StatusNotifierItem';

        if (service.startsWith('/')) {
            objectPath = service;
        } else if (service.startsWith('org.kde') || service.startsWith('org.freedesktop')) {
            // Reject cross-app spoofing: only the bus-name owner may
            // register an item under that name.
            if (sender && !await this._senderOwnsName(sender, service)) {
                invocation.return_dbus_error(
                    'org.freedesktop.DBus.Error.AccessDenied',
                    `Sender does not own ${service}`
                );
                return;
            }
            busName = service;
        }

        this._registerItem(busName, objectPath);

        invocation.return_value(null);
    }

    // Spec-required and signal-only. Clients wait for this signal
    // before showing their tray icons.
    RegisterStatusNotifierHostAsync(params, invocation) {
        if (this._dbusImpl)
            this._dbusImpl.emit_signal('StatusNotifierHostRegistered', null);

        invocation.return_value(null);
    }

    get RegisteredStatusNotifierItems() {
        return Array.from(this._items.keys());
    }

    get IsStatusNotifierHostRegistered() {
        return true;
    }

    get ProtocolVersion() {
        return 0;
    }

    async _senderOwnsName(sender, name) {
        try {
            const result = await callDBusDaemon(Gio.DBus.session,
                'GetNameOwner', new GLib.Variant('(s)', [name]),
                new GLib.VariantType('(s)'));
            return result.deep_unpack()[0] === sender;
        } catch {
            return false;
        }
    }

    _registerItem(busName, objectPath) {
        // The disabled check covers awaits (initial scan, owner check) that
        // resolve after disable() and would re-populate the cleared maps.
        if (!this._itemProxyClass || this._disabled)
            return;

        const id = getItemAddress(busName, objectPath);

        if (this._items.has(id) || this._pending.has(id))
            return;

        this._pending.set(id, busName);
        this._watchName(id, busName);

        new this._itemProxyClass(
            Gio.DBus.session,
            busName,
            objectPath,
            (proxy, proxyError) => {
                // The owner died mid-registration or the watcher was disabled.
                // Inserting anyway would leave a ghost icon: the vanish cleanup
                // already ran and took the name watch with it.
                if (!this._pending.delete(id))
                    return;

                if (proxyError) {
                    warn(`SniWatcher: Failed to create proxy for ${id}: ${proxyError.message}`);
                    this._unwatchName(id);
                    return;
                }

                const item = new TrayIcon(
                    this._extensionDir,
                    busName,
                    objectPath,
                    this._settings,
                    proxy,
                    (itemId, actor) => this._indicator.addIcon(itemId, actor),
                    itemId => this._onItemDestroyed(itemId),
                    () => this._indicator._handleIconClick(),
                    forwardDragStateToIndicator(this._indicator)
                );

                item.id = id;
                this._items.set(id, item);
                // Emitted only now: a consumer that answers this signal by
                // reading RegisteredStatusNotifierItems must find the item,
                // and one whose proxy failed must never be announced.
                this._dbusImpl.emit_signal('StatusNotifierItemRegistered',
                    GLib.Variant.new('(s)', [id]));
            }
        );
    }

    _onItemDestroyed(id) {
        this._unwatchName(id);
        this._items.delete(id);
        this._indicator.removeIcon(id);

        if (this._dbusImpl)
            this._dbusImpl.emit_signal('StatusNotifierItemUnregistered', GLib.Variant.new('(s)', [id]));
    }

    disable() {
        this._disabled = true;
        clearIds(this, removeTimer, '_scanTimeoutId');
        clearIds(this, Gio.bus_unown_name, '_kdeWatcherId', '_freedesktopWatcherId');
        disposeAll(this, 'unexport', '_dbusImpl');

        this._items.forEach(item => item.destroy());
        this._items.clear();
        this._pending.clear();
        this._nameWatchers.forEach(watcherId => Gio.bus_unwatch_name(watcherId));
        this._nameWatchers.clear();
    }
}
