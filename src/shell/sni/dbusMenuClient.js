import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {warn} from '../../shared/logging.js';
import {isCancelledError} from '../../shared/asyncIo.js';
import {clearIds, debounceTo, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {loadInterfaceXML} from '../dbusCalls.js';
import {isDisposed, trackDisposal} from '../disposal.js';
import {stageScaleFactor} from '../actorPlacement.js';

const GEOMETRY_SETTLE_MS = 50;

const YIELD_EVERY_N_ITEMS = 20;

const TOGGLE_STATE_ON = 1;

const MENU_ICON_SIZE = 16;

const ICON_INDEX_AFTER_ORNAMENT = 1;

const ICON_DATA_TYPE = new GLib.VariantType('ay');

// Every icon builds its own client, but the XML read and the wrapper
// generation are identical for all of them.
let _MenuProxyClass = null;

export class DBusMenuClient {
    constructor(busName, objectPath, extensionDir, settings, onCloseMenu) {
        this._busName = busName;
        this._objectPath = objectPath;
        this._extensionDir = extensionDir;
        this._settings = settings;
        this._proxy = null;
        this._onCloseMenu = onCloseMenu;
        this._closeTimeoutId = 0;
        this._pendingYieldIds = new Set();
        this._cancellable = new Gio.Cancellable();
    }

    init() {
        // The path comes from the item, so it can be junk. A junk path still
        // builds a proxy, it just logs GLib assertions and never answers, so
        // fail here and let the caller fall back to the app's ContextMenu.
        if (!GLib.Variant.is_object_path(this._objectPath))
            return Promise.reject(new Error(`Invalid menu object path: ${this._objectPath}`));

        _MenuProxyClass ??= Gio.DBusProxy.makeProxyWrapper(
            loadInterfaceXML(this._extensionDir, 'DBusMenu.xml'));

        return new Promise((resolve, reject) => {
            this._proxy = new _MenuProxyClass(
                Gio.DBus.session,
                this._busName,
                this._objectPath,
                (proxy, proxyError) => {
                    if (proxyError) {
                        reject(proxyError);
                        return;
                    }
                    resolve(true);
                }
            );
        });
    }

    async buildMenu(gnomeMenu) {
        // Apps that fill the root only on demand answer the first GetLayout
        // with no children, and a childless root reads as "no menu at all".
        try {
            await this._proxy.AboutToShowAsync(0);
        } catch { /* the root call is optional, not every server answers it */ }

        if (!this._proxy)
            return;

        const [, layout] = await this._proxy.GetLayoutAsync(0, -1, []);
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

        const isVisible = getProp('visible', true);
        if (!isVisible)
            return;

        // The peer picks these types, and a non-string label would throw
        // out of buildMenu and cost the whole menu, not just this item.
        const label = String(getProp('label', '')).replace(/_/g, '');
        const type = String(getProp('type', 'standard'));
        const isEnabled = getProp('enabled', true);
        // A non-string icon_name takes the whole shell down and no try/catch
        // stops it. Coercing is no help, the name would resolve to nothing.
        const rawIconName = getProp('icon-name', null);
        const iconName = typeof rawIconName === 'string' ? rawIconName : null;
        // Qt apps send raw bytes instead of a name. Kept packed, deep_unpack
        // would copy the whole image into a JS array first.
        const iconData = iconName ? null : this._iconDataVariant(props['icon-data']);
        const toggleType = getProp('toggle-type', '');
        const toggleState = getProp('toggle-state', 0);

        if (type === 'separator') {
            parent.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            return;
        }

        // The property alone counts, a subtree can still arrive empty here.
        const isSubmenu = getProp('children-display', '') === 'submenu' || children.length > 0;

        let item;
        if (isSubmenu) {
            item = new PopupMenu.PopupSubMenuMenuItem(label);
            item.menu.connect('open-state-changed',
                (menu, isOpen) => this._onSubMenuToggled(id, menu, isOpen));
            this._holdOpenLookDuringCollapse(item);
        } else {
            item = new PopupMenu.PopupMenuItem(label);

            if (toggleType === 'checkmark' || toggleType === 'radio')
                item.setOrnament(toggleState === TOGGLE_STATE_ON ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        }

        if ((iconName || iconData) && !isSubmenu) {
            // Tracked because the decode below can outlive a menu rebuild.
            const icon = trackDisposal(new St.Icon({
                style_class: 'popup-menu-icon',
                icon_size: MENU_ICON_SIZE,
            }));
            item.insert_child_at_index(icon, ICON_INDEX_AFTER_ORNAMENT);

            if (iconName)
                icon.icon_name = iconName;
            else
                this._applyIconData(icon, iconData);
        }

        item.setSensitive(isEnabled);

        if (isEnabled && !isSubmenu) {
            item.connect('activate', () => {
                this._onItemClicked(id, parent);
            });
        }

        parent.addMenuItem(item);
        if (!isSubmenu)
            return;

        // The shell won't open an empty submenu, so fill it before the
        // first click. Parented first, the alive checks go via the top menu.
        if (children.length > 0)
            await this._parseChildren(children, item.menu);
        else
            await this._loadSubMenu(id, item.menu);
    }

    _unpackNode(node) {
        const unpacked = node instanceof GLib.Variant ? node.deep_unpack() : node;
        return unpacked && unpacked.length >= 3 ? unpacked : null;
    }

    _iconDataVariant(value) {
        return value instanceof GLib.Variant && value.is_of_type(ICON_DATA_TYPE) && value.n_children()
            ? value : null;
    }

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
        /* eslint-disable no-await-in-loop */
        for (let i = 0; i < children.length; i++) {
            await this._parseNode(children[i], parent);
            if (i > 0 && i % YIELD_EVERY_N_ITEMS === 0)
                await this._yieldToMainLoop();
            if (!this._isLive(parent))
                return;
        }
        /* eslint-enable no-await-in-loop */
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
        if (!this._proxy)
            return;

        await this._loadSubMenu(id, submenu);
        if (!this._isLive(submenu))
            return;

        this._pinMenuWidth(submenu._getTopMenu());
    }

    // AboutToShow's reply is ignored, Nextcloud answers false right after
    // filling the subtree.
    async _loadSubMenu(id, submenu) {
        try {
            await this._proxy.AboutToShowAsync(id);
        } catch { /* optional like the root call, GetLayout still answers */ }

        if (!this._proxy)
            return;

        const [, [, , children]] = await this._proxy.GetLayoutAsync(id, -1, []);
        if (!this._isLive(submenu))
            return;

        submenu.removeAll();
        await this._parseChildren(children, submenu);
    }

    _isLive(menu) {
        return this._proxy !== null && !isDisposed(menu._getTopMenu().actor);
    }

    // Submenus sit collapsed inside the menu box, so opening one would widen
    // the whole menu and closing it would shrink it back.
    _pinMenuWidth(topMenu) {
        // Natural widths come in stage pixels, CSS px would scale again.
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

        parentMenu._getTopMenu().close();

        const shouldKeepPopup = this._settings.get_boolean('keep-popup-after-click');
        if (!shouldKeepPopup && this._onCloseMenu)
            debounceTo(this, '_closeTimeoutId', GEOMETRY_SETTLE_MS, () => this._onCloseMenu());
    }

    _sendEvent(id, eventId) {
        if (!this._proxy)
            return;

        const time = Clutter.get_current_event_time();
        this._proxy.EventAsync(id, eventId, new GLib.Variant('s', ''), time)
            .catch(err => warn(`DBusMenu Event Error (${eventId}): ${err.message}`));
    }

    destroy() {
        disposeAll(this, 'cancel', '_cancellable');
        clearIds(this, removeTimer, '_closeTimeoutId');
        for (const id of this._pendingYieldIds)
            GLib.source_remove(id);
        this._pendingYieldIds.clear();
        this._proxy = null;
        this._onCloseMenu = null;
    }
}
