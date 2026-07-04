import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn, error} from '../shared/logging.js';
import {clearIds, disconnectSignal, disposeAll, removeTimer} from '../shared/lifecycle.js';
import {loadInterfaceXML, getUniqueId} from './utils/dbus.js';
import {TrayIcon} from './trayIcon.js';
import {forwardDragStateToIndicator} from './features/dragAndDrop.js';
import {INITIAL_SCAN_DELAY_MS} from '../const.js';

export class SniWatcher {
    constructor(extensionDir, indicator, settings) {
        this._extensionDir = extensionDir;
        this._indicator = indicator;
        this._settings = settings;

        this._items = new Map();
        this._dbusImpl = null;

        this._kdeWatcherId = 0;
        this._freedesktopWatcherId = 0;
        this._nameWatcherId = 0;

        // Both bus names trigger a scan when owned. Run it once.
        this._scanTimeoutId = 0;
        this._hasScanned = false;

        // Build once, reuse per TrayIcon.
        try {
            const itemXml = loadInterfaceXML(this._extensionDir, 'StatusNotifierItem.xml');
            this._itemProxyClass = Gio.DBusProxy.makeProxyWrapper(itemXml);
        } catch (e) {
            error('SniWatcher: Failed to load StatusNotifierItem.xml', e);
        }
    }

    enable() {
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
            // of waiting in the bus queue. REPLACE is omitted, because it
            // would take the well-known name from another running watcher.
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

            // One global NameOwnerChanged listener instead of one per icon.
            this._nameWatcherId = Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus',
                'org.freedesktop.DBus',
                'NameOwnerChanged',
                '/org/freedesktop/DBus',
                null,
                Gio.DBusSignalFlags.NONE,
                this._onNameOwnerChanged.bind(this)
            );
        } catch (e) {
            error('SniWatcher: Failed to enable', e);
        }
    }

    _onNameOwnerChanged(connection, sender, objectPath, interfaceName, signalName, parameters) {
        const [name, , newOwner] = parameters.deep_unpack();

        // Empty newOwner means the name is gone.
        if (newOwner === '') {
            // Iterate over a snapshot so destroy() can mutate the map.
            for (const item of Array.from(this._items.values())) {
                if (item.busName === name)
                    item.destroy();
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
            const result = await Gio.DBus.session.call(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'ListNames',
                null,
                new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );

            const [names] = result.deep_unpack();

            if (!names || !Array.isArray(names))
                return;

            for (const name of names) {
                // Accept both prefixes, because Electron apps register under
                // org.kde.StatusNotifierItem-PID-ID instead of the freedesktop variant.
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
        let sender = null;

        try {
            sender = invocation.get_sender();
        } catch { /* anonymous client */ }

        // KDE clients pass the object path here, freedesktop clients pass the bus name.
        // Detect by the leading character.
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

        if (this._dbusImpl)
            this._dbusImpl.emit_signal('StatusNotifierItemRegistered', GLib.Variant.new('(s)', [service]));


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
            const result = await Gio.DBus.session.call(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'GetNameOwner',
                new GLib.Variant('(s)', [name]),
                new GLib.VariantType('(s)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            return result.deep_unpack()[0] === sender;
        } catch {
            return false;
        }
    }

    _registerItem(busName, objectPath) {
        if (!this._itemProxyClass)
            return;

        const id = getUniqueId(busName, objectPath);

        if (this._items.has(id))
            return;

        new this._itemProxyClass(
            Gio.DBus.session,
            busName,
            objectPath,
            (proxy, proxyError) => {
                if (proxyError) {
                    warn(`SniWatcher: Failed to create proxy for ${id}: ${proxyError.message}`);
                    return;
                }

                // State may have changed during async proxy creation, so re-check
                // before registering.
                if (!this._dbusImpl || this._items.has(id))
                    return;

                const item = new TrayIcon(
                    this._extensionDir,
                    busName,
                    objectPath,
                    this._settings,
                    proxy,
                    (itemId, actor) => this._indicator.addIcon(itemId, actor),
                    itemId => this._onItemDestroyed(itemId),
                    () => this._indicator?._handleIconClick?.(),
                    forwardDragStateToIndicator(this._indicator)
                );

                item.id = id;
                this._items.set(id, item);
            }
        );
    }

    _onItemDestroyed(id) {
        if (this._items.has(id)) {
            this._items.delete(id);
            this._indicator.removeIcon(id);

            if (this._dbusImpl)
                this._dbusImpl.emit_signal('StatusNotifierItemUnregistered', GLib.Variant.new('(s)', [id]));
        }
    }

    disable() {
        clearIds(this, removeTimer, '_scanTimeoutId');
        clearIds(this, Gio.bus_unown_name, '_kdeWatcherId', '_freedesktopWatcherId');
        disconnectSignal(this, Gio.DBus.session, '_nameWatcherId', 'signal_unsubscribe');
        disposeAll(this, 'unexport', '_dbusImpl');

        this._items.forEach(item => item.destroy());
        this._items.clear();
    }
}
