import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {warn} from '../../shared/logging.js';
import {clearIds, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {loadInterfaceXML} from '../utils/dbus.js';
import {isDisposed, stageScaleFactor} from '../utils/actor.js';

const GEOMETRY_SETTLE_MS = 50;

const DBUS_MENU_YIELD_EVERY_N_ITEMS = 20;

// Every icon builds its own client, but the XML read and wrapper generation
// are identical, so generate the proxy class once per process.
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
        // The path comes from the item's Menu property, so a peer can put
        // anything there. Measured: the proxy still constructs and its callback
        // still reports success, it just logs a GLib assertion per signal
        // subscription and answers nothing afterwards. Failing here instead
        // sends the caller to the app's own ContextMenu right away.
        if (!GLib.Variant.is_object_path(this.objectPath))
            return Promise.reject(new Error(`Invalid menu object path: ${this.objectPath}`));

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
        // Apps that fill the root only on demand answer the first GetLayout
        // with no children, and a childless root reads as "no menu at all".
        try {
            await this.proxy.AboutToShowAsync(0);
        } catch { /* the root call is optional, not every server answers it */ }

        if (!this.proxy)
            return;

        const [, layout] = await this.proxy.GetLayoutAsync(0, -1, []);

        if (!layout) {
            warn(`DBusMenu (${this.busName}): Layout is null or invalid`);
            return;
        }

        await this._parseNode(layout, gnomeMenu);
        this._pinMenuWidth(gnomeMenu);
    }

    async _parseNode(node, parent) {
        const unpacked = this._unpackNode(node);
        if (!unpacked)
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
            await this._parseChildren(children, parent);
            return;
        }

        const visible = getProp('visible', true);
        if (!visible)
            return;

        // The peer picks these types, and a non-string label would throw
        // out of buildMenu and cost the whole menu, not just this item.
        const label = String(getProp('label', '')).replace(/_/g, '');
        const type = String(getProp('type', 'standard'));
        const enabled = getProp('enabled', true);
        // Same reason label and type go through String() above, except a
        // coerced icon name would only resolve to nothing anyway: St.Icon
        // throws on a non-string, and that throw costs the whole menu.
        const rawIconName = getProp('icon-name', null);
        const iconName = typeof rawIconName === 'string' ? rawIconName : null;
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

                // The shell refuses to open an empty submenu, so the items
                // have to exist before the first click can expand it.
                await this._parseChildren(children, item.menu);

                item.menu.connect('open-state-changed',
                    (menu, isOpen) => this._onSubMenuToggled(id, menu, isOpen));
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

    async _parseChildren(children, parent) {
        if (!children || children.length === 0)
            return;

        // Yield to the main loop every N items so a large menu does not
        // freeze the UI while it builds.
        /* eslint-disable no-await-in-loop */
        for (let i = 0; i < children.length; i++) {
            await this._parseNode(children[i], parent);
            if (i > 0 && i % DBUS_MENU_YIELD_EVERY_N_ITEMS === 0)
                await this._yieldToMainLoop();
        }
        /* eslint-enable no-await-in-loop */
    }

    _onSubMenuToggled(id, submenu, isOpen) {
        this._sendEvent(id, isOpen ? 'opened' : 'closed');

        if (isOpen) {
            this._refreshSubMenu(id, submenu)
                .catch(err => warn(`DBusMenu Refresh Error: ${err.message}`));
        }
    }

    // Apps with dynamic menus fill a subtree server-side only on
    // AboutToShow, so the children from the initial GetLayout can be
    // stale or empty.
    async _refreshSubMenu(id, submenu) {
        if (!this.proxy)
            return;

        const [needUpdate] = await this.proxy.AboutToShowAsync(id);
        if (!needUpdate || !this.proxy)
            return;

        const [, layout] = await this.proxy.GetLayoutAsync(id, -1, []);
        const node = this._unpackNode(layout);

        // The menu can be torn down while the calls are in flight.
        if (!node || !this.proxy || isDisposed(submenu.actor))
            return;

        submenu.removeAll();
        await this._parseChildren(node[2], submenu);
        this._pinMenuWidth(submenu._getTopMenu());
    }

    // Submenus sit collapsed inside the menu box, so opening one would widen
    // the whole menu and closing it would shrink it back.
    _pinMenuWidth(topMenu) {
        // The measured width is already scaled, CSS px would scale again.
        const width = Math.ceil(this._maxNaturalWidth(topMenu) / stageScaleFactor());
        topMenu.box.style = `min-width: ${width}px`;
    }

    _maxNaturalWidth(menu) {
        let [, width] = menu.box.get_preferred_width(-1);
        for (const item of menu._getMenuItems()) {
            if (item.menu)
                width = Math.max(width, this._maxNaturalWidth(item.menu));
        }
        return width;
    }

    _onItemClicked(id, parentMenu) {
        this._sendEvent(id, 'clicked');

        // Submenus expose `_parent`, but the top-level PopupMenu doesn't, it
        // is only reachable via the owning actor's `_delegate.menu`.
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
        if (!keepOverflow && this.onCloseMenu)
            debounceTo(this, '_closeTimeoutId', GEOMETRY_SETTLE_MS, () => this.onCloseMenu());
    }

    _sendEvent(id, eventId) {
        if (!this.proxy)
            return;

        const time = Clutter.get_current_event_time();
        this.proxy.EventAsync(id, eventId, new GLib.Variant('s', ''), time)
            .catch(err => warn(`DBusMenu Event Error (${eventId}): ${err.message}`));
    }

    _unpackNode(node) {
        const unpacked = node instanceof GLib.Variant ? node.deep_unpack() : node;
        return unpacked && unpacked.length >= 3 ? unpacked : null;
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

    destroy() {
        clearIds(this, removeTimer, '_closeTimeoutId');
        for (const id of this._pendingYieldIds)
            GLib.source_remove(id);
        this._pendingYieldIds.clear();
        this.proxy = null;
        this.onCloseMenu = null;
    }
}
