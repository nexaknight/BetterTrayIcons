import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {warn} from '../shared/logging.js';
import {clearIds, removeTimer} from '../shared/lifecycle.js';
import {loadInterfaceXML} from './utils/dbus.js';
import {GEOMETRY_SETTLE_MS, DBUS_MENU_YIELD_EVERY_N_ITEMS} from '../const.js';

// One generated proxy class per process. Every icon builds its own
// client, but the XML read and wrapper generation are identical.
let _MenuProxyClass = null;

export class DBusMenuClient {
    constructor(busName, objectPath, extensionDir, settings, onCloseMenu) {
        this.busName = busName;
        this.objectPath = objectPath;
        this.extensionDir = extensionDir;
        this.settings = settings;
        this.proxy = null;
        this.onCloseMenu = onCloseMenu;
        this._closeTimeoutId = 0;
        this._pendingYieldIds = new Set();
    }

    init() {
        _MenuProxyClass ??= Gio.DBusProxy.makeProxyWrapper(
            loadInterfaceXML(this.extensionDir, 'DBusMenu.xml'));

        return new Promise((resolve, reject) => {
            this.proxy = new _MenuProxyClass(
                Gio.DBus.session,
                this.busName,
                this.objectPath,
                (proxy, proxyError) => {
                    if (proxyError)
                        reject(proxyError);
                    else
                        resolve(true);
                }
            );
        });
    }

    async buildMenu(gnomeMenu) {
        if (!this.proxy)
            return;

        const [, layout] = await this.proxy.GetLayoutAsync(0, -1, []);

        if (!layout) {
            warn(`DBusMenu (${this.busName}): Layout is null or invalid`);
            return;
        }

        await this._parseNode(layout, gnomeMenu);
    }

    async _parseNode(node, parent) {
        const unpacked = node instanceof GLib.Variant ? node.deep_unpack() : node;

        if (!unpacked || unpacked.length < 3)
            return;

        const id = unpacked[0];
        const props = unpacked[1];
        const children = unpacked[2];

        const getProp = (key, fallback) => {
            if (!props[key])
                return fallback;
            return props[key] instanceof GLib.Variant ? props[key].deep_unpack() : props[key];
        };

        if (id === 0) {
            if (children && children.length > 0) {
                // Sequential awaits are intentional: we yield to the main loop
                // every N items so large menus don't block the UI thread.
                /* eslint-disable no-await-in-loop */
                for (let i = 0; i < children.length; i++) {
                    await this._parseNode(children[i], parent);
                    if (i > 0 && i % DBUS_MENU_YIELD_EVERY_N_ITEMS === 0)
                        await this._yieldToMainLoop();
                }
                /* eslint-enable no-await-in-loop */
            }
            return;
        }

        const visible = getProp('visible', true);
        if (!visible)
            return;

        const label = getProp('label', '').replace(/_/g, '');
        const type = getProp('type', 'standard');
        const enabled = getProp('enabled', true);
        const iconName = getProp('icon-name', null);
        const toggleType = getProp('toggle-type', '');
        const toggleState = getProp('toggle-state', 0);

        let item;

        if (type === 'separator') {
            item = new PopupMenu.PopupSeparatorMenuItem();
            parent.addMenuItem(item);
        } else {
            const hasChildren = children && children.length > 0;

            if (hasChildren) {
                item = new PopupMenu.PopupSubMenuMenuItem(label);

                // Lazy load: populate the submenu only when it opens.
                let loaded = false;
                const populateSubMenu = async () => {
                    if (loaded)
                        return;
                    loaded = true;
                    // Same sequential-with-yield pattern as the top-level loop.
                    /* eslint-disable no-await-in-loop */
                    for (let i = 0; i < children.length; i++) {
                        await this._parseNode(children[i], item.menu);
                        if (i > 0 && i % DBUS_MENU_YIELD_EVERY_N_ITEMS === 0)
                            await this._yieldToMainLoop();
                    }
                    /* eslint-enable no-await-in-loop */
                };

                item.menu.connect('open-state-changed', (menu, isOpen) => {
                    if (isOpen)
                        populateSubMenu();
                });
            } else {
                item = new PopupMenu.PopupMenuItem(label);

                if (toggleType === 'checkmark' || toggleType === 'radio')
                    item.setOrnament(toggleState === 1 ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            }

            if (iconName && !(item instanceof PopupMenu.PopupSubMenuMenuItem)) {
                const icon = new St.Icon({
                    icon_name: iconName,
                    style_class: 'popup-menu-icon',
                    icon_size: 16,
                });
                item.insert_child_at_index(icon, 1);
            }

            item.setSensitive(enabled);

            if (enabled && !hasChildren) {
                item.connect('activate', () => {
                    this._onItemClicked(id, parent);
                });
            }

            parent.addMenuItem(item);
        }
    }

    _yieldToMainLoop() {
        return new Promise(resolve => {
            const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._pendingYieldIds.delete(id);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._pendingYieldIds.add(id);
        });
    }

    _onItemClicked(id, parentMenu) {
        const time = Clutter.get_current_event_time();

        if (this.proxy) {
            this.proxy.EventAsync(id, 'clicked', new GLib.Variant('s', ''), time)
                .catch(err => warn(`DBusMenu Click Error: ${err.message}`));
        }

        // Walk up the parent chain to find the outermost PopupMenu. Submenus
        // expose `_parent`. The top-level PopupMenu reaches itself via the
        // owning actor's `_delegate.menu`.
        let iter = parentMenu;
        while (iter) {
            if (iter instanceof PopupMenu.PopupMenu) {
                iter.close();
                break;
            }
            iter = iter._parent;
            if (!iter && parentMenu.actor && parentMenu.actor._delegate && parentMenu.actor._delegate.menu)
                iter = parentMenu.actor._delegate.menu;

            if (!iter)
                break;
        }

        const keepOverflow = this.settings.get_boolean('keep-popup-after-click');
        if (!keepOverflow && this.onCloseMenu) {
            clearIds(this, removeTimer, '_closeTimeoutId');
            this._closeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GEOMETRY_SETTLE_MS, () => {
                this._closeTimeoutId = 0;
                this.onCloseMenu();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    destroy() {
        clearIds(this, removeTimer, '_closeTimeoutId');
        for (const id of this._pendingYieldIds)
            GLib.source_remove(id);
        this._pendingYieldIds.clear();
        this.proxy = null;
        this.onCloseMenu = null;
    }
}
