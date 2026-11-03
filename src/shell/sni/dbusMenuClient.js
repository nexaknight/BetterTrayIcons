import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {warn} from '../../shared/logging.js';
import {isCancelledError} from '../../shared/asyncIo.js';
import {isChromatic, parseRgb, tintedSymbolicIcon} from '../../shared/iconLoading.js';
import {clearIds, debounceTo, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed, trackDisposal} from '../disposal.js';
import {stageScaleFactor} from '../actorPlacement.js';
import {themeIconFile} from '../icons/iconResolver.js';
import {applyMenuBoxStyle, closeMenuChain, FlyoutMenu, menuAnimation, menuForegroundColor, POPUP_ANIMATION_FULL, POPUP_ANIMATION_NONE, submenuFitsInline} from '../popupMenus.js';

const GEOMETRY_SETTLE_MS = 50;

const YIELD_EVERY_N_ITEMS = 20;

const MENU_ROOT_ID = 0;

const LAYOUT_DEPTH_ALL = -1;

const TOGGLE_STATE_ON = 1;

const MENU_ICON_SIZE = 16;

const ICON_INDEX_AFTER_ORNAMENT = 1;

const ICON_DATA_TYPE = new GLib.VariantType('ay');

const RGBA_CHANNELS = 4;

// A transparent pixel can carry any color, which would read as a colored
// pixmap.
const OPAQUE_ALPHA_MIN = 128;

// Room for any real menu icon, the menu draws them at 16 px.
const ICON_DATA_MAX_PIXELS = 1024 * 1024;

// The PNG loader reports the size once it reaches the image data, so a file
// with more metadata than this ahead of it gets refused.
const ICON_DATA_HEADER_BYTES = 4096;

// Every icon builds its own client, the proxy wrapper is the same for all.
let _MenuProxyClass = null;

export function clearMenuProxyClass() {
    _MenuProxyClass = null;
}

export class DBusMenuClient {
    constructor(busName, objectPath, interfaceXml, settings, onCloseMenu) {
        this._busName = busName;
        this._objectPath = objectPath;
        this._interfaceXml = interfaceXml;
        this._settings = settings;
        this._proxy = null;
        this._onCloseMenu = onCloseMenu;
        this._closeTimeoutId = 0;
        this._idleIds = new Set();
        this._flyouts = new Set();
        this._cancellable = new Gio.Cancellable();
    }

    init() {
        // The path comes from the item, so it can be junk. A junk path still
        // builds a proxy, it just logs GLib assertions and never answers, so
        // fail here and let the caller fall back to the app's ContextMenu.
        if (!GLib.Variant.is_object_path(this._objectPath))
            return Promise.reject(new Error(`Invalid menu object path: ${this._objectPath}`));

        _MenuProxyClass ??= Gio.DBusProxy.makeProxyWrapper(this._interfaceXml);

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
        // The shell keeps one open submenu per menu, so opening a nested
        // one would fold its parent.
        gnomeMenu._setOpenedSubMenu = foldSiblingsOnly;
        this._bindFlyoutOwner(gnomeMenu);

        // Apps that fill the root only on demand answer the first GetLayout
        // with no children, and a childless root reads as "no menu at all".
        try {
            await this._proxy.AboutToShowAsync(MENU_ROOT_ID);
        } catch { /* the root call is optional, not every server answers it */ }

        if (!this._proxy)
            return;

        const [, layout] = await this._proxy.GetLayoutAsync(MENU_ROOT_ID, LAYOUT_DEPTH_ALL, []);
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

        const [id, props, children] = unpacked;

        const getProp = (key, fallback) => {
            if (!props[key])
                return fallback;
            return props[key] instanceof GLib.Variant ? props[key].deep_unpack() : props[key];
        };

        if (id === MENU_ROOT_ID) {
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
            item.setSubmenuShown = shown => this._showSubMenu(item, id, shown);
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
                this._applyThemedIcon(icon, iconName);
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

    // A theme icon that is not symbolic keeps whatever grey its file declares,
    // and on one of the two menu backgrounds that grey is invisible.
    async _applyThemedIcon(icon, iconName) {
        icon.icon_name = iconName;

        const size = MENU_ICON_SIZE * stageScaleFactor();
        const file = themeIconFile(iconName, size);
        if (!file)
            return;

        const tinted = await tintedSymbolicIcon(file, menuForegroundColor(),
            {size, cancellable: this._cancellable});
        if (tinted && !isDisposed(icon))
            icon.gicon = tinted;
    }

    async _applyIconData(icon, iconData) {
        const bytes = iconData.get_data_as_bytes();
        const size = MENU_ICON_SIZE * stageScaleFactor();

        try {
            if (!fitsDecodeLimit(bytes))
                throw new Error('image exceeds the decode limit');
            const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
            const pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, size, size, true, this._cancellable);
            if (!isDisposed(icon))
                icon.gicon = recoloredMonochrome(pixbuf, menuForegroundColor()) ?? pixbuf;
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
        return new Promise(resolve => this._runOnIdle(resolve));
    }

    _runOnIdle(fn) {
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idleIds.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._idleIds.add(id);
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

        if (!isOpen) {
            // The shell folds only this level, open children keep their state
            closeSubMenusIn(submenu, false);
            return;
        }

        this._refreshSubMenu(id, submenu)
            .catch(err => warn(`DBusMenu Refresh Error: ${err.message}`));
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

        const [, [, , children]] = await this._proxy.GetLayoutAsync(id, LAYOUT_DEPTH_ALL, []);
        if (!this._isLive(submenu))
            return;

        submenu.removeAll();
        await this._parseChildren(children, submenu);
    }

    _showSubMenu(item, id, shown) {
        const flyout = this._flyoutOf(item);
        if (flyout) {
            flyout.close(POPUP_ANIMATION_FULL);
            return;
        }
        if (!shown) {
            item.menu.close(POPUP_ANIMATION_FULL);
            return;
        }

        this._closeFlyoutsUnder(item._getTopMenu());
        if (submenuFitsInline(item.menu)) {
            item.menu.open(POPUP_ANIMATION_FULL);
            return;
        }
        this._openFlyout(item, id)
            .catch(err => warn(`DBusMenu Flyout Error: ${err.message}`));
    }

    _flyoutOf(item) {
        for (const flyout of this._flyouts) {
            if (flyout.sourceActor === item)
                return flyout;
        }
        return null;
    }

    async _openFlyout(item, id) {
        const flyout = new FlyoutMenu(item);
        trackDisposal(flyout.actor);
        flyout._setOpenedSubMenu = foldSiblingsOnly;
        this._bindFlyoutOwner(flyout);
        flyout.connect('open-state-changed', (menu, isOpen) => {
            // Nothing else marks the item, its inline submenu stays shut
            if (isOpen) {
                item.add_style_pseudo_class('checked');
                return;
            }
            item.remove_style_pseudo_class('checked');
            this._sendEvent(id, 'closed');
            this._dropFlyout(menu);
        });
        this._flyouts.add(flyout);

        await this._loadSubMenu(id, flyout);
        if (!this._isLive(flyout))
            return;
        // The tray menu can close while we wait for the layout
        if (!flyout.ownerMenu.isOpen) {
            this._dropFlyout(flyout);
            return;
        }

        this._pinMenuWidth(flyout);
        flyout.open(POPUP_ANIMATION_FULL);
        this._sendEvent(id, 'opened');
    }

    // A turn later the items the flyouts hang off are already gone
    _bindFlyoutOwner(menu) {
        menu.connect('open-state-changed', (owner, isOpen) => {
            if (!isOpen)
                this._closeFlyoutsUnder(owner);
        });
        menu.connect('destroy', () => {
            for (const flyout of this._flyoutsUnder(menu)) {
                this._flyouts.delete(flyout);
                flyout.destroy();
            }
        });
    }

    _closeFlyoutsUnder(menu) {
        for (const flyout of this._flyoutsUnder(menu))
            flyout.close(POPUP_ANIMATION_NONE);
    }

    _flyoutsUnder(menu) {
        return Array.from(this._flyouts).filter(flyout => flyout.ownerMenu === menu);
    }

    // Still mid-emission when the flyout reports closed
    _dropFlyout(flyout) {
        this._runOnIdle(() => {
            if (this._flyouts.delete(flyout))
                flyout.destroy();
        });
    }

    _isLive(menu) {
        return this._proxy !== null && !isDisposed(menu._getTopMenu().actor);
    }

    // Submenus sit collapsed inside the menu box, so opening one would widen
    // the whole menu and closing it would shrink it back.
    _pinMenuWidth(topMenu) {
        // Natural widths come in stage pixels, CSS px would scale again.
        const width = Math.ceil(this._maxNaturalWidth(topMenu) / stageScaleFactor());
        applyMenuBoxStyle(topMenu, `min-width: ${width}px`);
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

        closeMenuChain(parentMenu._getTopMenu());

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
        for (const id of this._idleIds)
            GLib.source_remove(id);
        this._idleIds.clear();
        for (const flyout of this._flyouts)
            flyout.destroy();
        this._flyouts.clear();
        this._proxy = null;
        this._onCloseMenu = null;
    }
}

// The PNG loader allocates the full canvas before it scales, and a small file
// can name a huge canvas. A zero size set from size-prepared stops it ahead of
// that allocation (gdk-pixbuf io-png.c, png_info_callback).
function fitsDecodeLimit(bytes) {
    const loader = new GdkPixbuf.PixbufLoader();
    let fits = false;
    loader.connect('size-prepared', (_loader, width, height) => {
        fits = width * height <= ICON_DATA_MAX_PIXELS;
        if (!fits)
            loader.set_size(0, 0);
    });
    const header = GLib.Bytes.new_from_bytes(bytes, 0, Math.min(bytes.get_size(), ICON_DATA_HEADER_BYTES));
    try {
        loader.write_bytes(header);
        loader.close();
    } catch {
        // Only the size matters, not whether the cut-off image decodes
    }
    return fits;
}

// An app renders its menu pixmaps for its own theme, and one flat grey lands
// invisible on the other one.
function recoloredMonochrome(pixbuf, color) {
    if (!pixbuf.get_has_alpha())
        return null;

    const rgb = parseRgb(color);
    if (!rgb)
        return null;

    const pixels = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    if (!isMonochrome(pixels, rowstride, width, height))
        return null;

    const [red, green, blue] = rgb;
    const recolored = new Uint8Array(pixels);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = y * rowstride + x * RGBA_CHANNELS;
            recolored[offset] = red;
            recolored[offset + 1] = green;
            recolored[offset + 2] = blue;
        }
    }

    return GdkPixbuf.Pixbuf.new_from_bytes(GLib.Bytes.new(recolored),
        pixbuf.get_colorspace(), true, pixbuf.get_bits_per_sample(), width, height, rowstride);
}

function isMonochrome(pixels, rowstride, width, height) {
    let opaque = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = y * rowstride + x * RGBA_CHANNELS;
            if (pixels[offset + 3] < OPAQUE_ALPHA_MIN)
                continue;
            if (isChromatic([pixels[offset], pixels[offset + 1], pixels[offset + 2]]))
                return false;
            opaque++;
        }
    }
    return opaque > 0;
}

function foldSiblingsOnly(submenu) {
    if (submenu)
        closeSubMenusIn(submenu._parent, true, submenu);
}

function closeSubMenusIn(menu, animate, keepOpen = null) {
    for (const item of menu._getMenuItems()) {
        if (item.menu && item.menu !== keepOpen)
            item.menu.close(menuAnimation(animate));
    }
}
