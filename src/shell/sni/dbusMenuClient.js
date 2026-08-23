import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {warn} from '../../shared/logging.js';
import {isCancelledError} from '../../shared/fetch.js';
import {clearIds, debounceTo, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {loadInterfaceXML} from '../utils/dbus.js';
import {isDisposed, stageScaleFactor, trackDisposal} from '../utils/actor.js';

const GEOMETRY_SETTLE_MS = 50;

const DBUS_MENU_YIELD_EVERY_N_ITEMS = 20;

const MENU_ICON_SIZE = 16;

const ICON_DATA_TYPE = new GLib.VariantType('ay');

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
        this._cancellable = new Gio.Cancellable();
    }

    init() {
        // The path comes from the item, so it can be junk. A junk path still
        // builds a proxy, it just logs GLib assertions and never answers, so
        // fail here and let the caller fall back to the app's ContextMenu.
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
        if (!this._isLive(gnomeMenu))
            return;

        await this._parseNode(layout, gnomeMenu);
        if (!this._isLive(gnomeMenu))
            return;

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
        // A non-string icon_name takes the whole shell down and no try/catch
        // stops it. Coercing is no help, the name would resolve to nothing.
        const rawIconName = getProp('icon-name', null);
        const iconName = typeof rawIconName === 'string' ? rawIconName : null;
        // Qt apps send raw bytes instead of a name. Kept packed, deep_unpack
        // would copy the whole image into a JS array first.
        const iconData = iconName ? null : this._iconDataVariant(props['icon-data']);
        const toggleType = getProp('toggle-type', '');
        const toggleState = getProp('toggle-state', 0);

        let item;

        if (type === 'separator') {
            item = new PopupMenu.PopupSeparatorMenuItem();
            parent.addMenuItem(item);
        } else {
            // The property alone counts, a subtree can still arrive empty here.
            const isSubmenu = getProp('children-display', '') === 'submenu' || children.length > 0;

            if (isSubmenu) {
                item = new PopupMenu.PopupSubMenuMenuItem(label);
                item.menu.connect('open-state-changed',
                    (menu, isOpen) => this._onSubMenuToggled(id, menu, isOpen));
                this._holdOpenLookDuringCollapse(item);
            } else {
                item = new PopupMenu.PopupMenuItem(label);

                if (toggleType === 'checkmark' || toggleType === 'radio')
                    item.setOrnament(toggleState === 1 ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            }

            if ((iconName || iconData) && !isSubmenu) {
                // Tracked because the decode below can outlive a menu rebuild.
                const icon = trackDisposal(new St.Icon({
                    style_class: 'popup-menu-icon',
                    icon_size: MENU_ICON_SIZE,
                }));
                item.insert_child_at_index(icon, 1);

                if (iconName)
                    icon.icon_name = iconName;
                else
                    this._applyIconData(icon, iconData);
            }

            item.setSensitive(enabled);

            if (enabled && !isSubmenu) {
                item.connect('activate', () => {
                    this._onItemClicked(id, parent);
                });
            }

            parent.addMenuItem(item);

            // The shell won't open an empty submenu, so fill it before the
            // first click. Parented first, the alive checks go via the top menu.
            if (isSubmenu) {
                if (children.length > 0)
                    await this._parseChildren(children, item.menu);
                else
                    await this._loadSubMenu(id, item.menu);
            }
        }
    }

    _iconDataVariant(value) {
        return value instanceof GLib.Variant && value.is_of_type(ICON_DATA_TYPE) && value.n_children()
            ? value : null;
    }

    // Arbitrary image bytes from the app, so decode off the main loop and
    // leave the icon empty if they turn out to be garbage.
    async _applyIconData(icon, iconData) {
        const stream = Gio.MemoryInputStream.new_from_bytes(iconData.get_data_as_bytes());

        try {
            const pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_async(stream, this._cancellable);
            if (!isDisposed(icon))
                icon.gicon = pixbuf;
        } catch (e) {
            if (!isCancelledError(e))
                warn(`DBusMenu icon-data decode failed: ${e.message}`);
        }
    }

    async _parseChildren(children, parent) {
        // Yield to the main loop every N items so a large menu does not
        // freeze the UI while it builds.
        /* eslint-disable no-await-in-loop */
        for (let i = 0; i < children.length; i++) {
            await this._parseNode(children[i], parent);
            if (i > 0 && i % DBUS_MENU_YIELD_EVERY_N_ITEMS === 0)
                await this._yieldToMainLoop();
            if (!this._isLive(parent))
                return;
        }
        /* eslint-enable no-await-in-loop */
    }

    // The shell drops `checked` when the collapse starts, so the item snaps
    // round while the submenu is still shrinking under it.
    _holdOpenLookDuringCollapse(item) {
        item.menu.connect('open-state-changed', (menu, isOpen) => {
            if (!isOpen)
                item.add_style_pseudo_class('checked');
        });
        item.menu.actor.connect('hide', () => item.remove_style_pseudo_class('checked'));
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

        await this._loadSubMenu(id, submenu);
        if (!this._isLive(submenu))
            return;

        this._pinMenuWidth(submenu._getTopMenu());
    }

    // AboutToShow's reply is ignored on purpose, Nextcloud answers false
    // right after filling the subtree.
    async _loadSubMenu(id, submenu) {
        try {
            await this.proxy.AboutToShowAsync(id);
        } catch { /* optional like the root call, GetLayout still answers */ }

        if (!this.proxy)
            return;

        const [, [, , children]] = await this.proxy.GetLayoutAsync(id, -1, []);
        if (!this._isLive(submenu))
            return;

        submenu.removeAll();
        await this._parseChildren(children, submenu);
    }

    // A call in flight can outlive the whole client, or just the menu.
    _isLive(menu) {
        return this.proxy !== null && !isDisposed(menu._getTopMenu().actor);
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
        disposeAll(this, 'cancel', '_cancellable');
        clearIds(this, removeTimer, '_closeTimeoutId');
        for (const id of this._pendingYieldIds)
            GLib.source_remove(id);
        this._pendingYieldIds.clear();
        this.proxy = null;
        this.onCloseMenu = null;
    }
}
