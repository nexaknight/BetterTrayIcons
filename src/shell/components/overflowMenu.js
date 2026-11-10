import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {generateBoxStyle, letBlurSeeThrough, popupUsesLightStyle, syncBackgroundBlur} from '../trayStyle.js';
import {createPanelMenu, destroyMenuSafely, keepsOverflowOpen, panelMenuManagerFor, POPUP_ANIMATION_NONE} from '../popupMenus.js';
import {clearIds, removeTimer} from '../../shared/lifecycle.js';
import {FOREIGN_ACTOR_PROP} from '../api/foreignItems.js';
import {ITEM_SPACING_PX, ICON_MARGIN_PX, DEFAULT_ICON_PADDING_PX} from '../../const.js';

const OVERFLOW_GRID_MIN_ROW_HEIGHT_PX = 24;

// Keeps a wide overflow popup from being clamped flush against the screen edges.
const OVERFLOW_SCREEN_MARGIN_PX = 64;

const POPUP_UNCLAMP_CSS = 'min-width: 0; min-height: 0;';

// With 0 the BoxPointer wrapper collapses and clips the popup contents.
const CONTAINER_SIDE_MARGIN_MIN_PX = 1;

// Stock mode pads the sides so icons don't clip at the popup-menu-content
// frame.
const CONTAINER_STOCK_SIDE_PADDING_PX = 1;

const FLOW_WIDTH_SLACK_PX = 1;

const POPUP_PACKING = Object.freeze({
    spacing: ITEM_SPACING_PX,
    sidePadding: CONTAINER_STOCK_SIDE_PADDING_PX,
    slack: FLOW_WIDTH_SLACK_PX,
});

const MENU_CONTENT_STYLE_CLASS = 'popup-menu-content';

// The flow box that holds the overflow icons. The popup hosts it in a menu,
// the drawer inline in the panel.
export class OverflowSurface {
    constructor(settings, onOpenStateChanged, packing = POPUP_PACKING) {
        this._settings = settings;
        this._onOpenStateChanged = onOpenStateChanged;
        this._packing = packing;

        this._cachedBaseStyle = '';
        this._enableCustomStyle = false;

        // Both modes flow. Row mode stays on one line by being handed a width
        // that fits, and wraps instead of running off the monitor when it can't.
        this._container = new St.Widget({
            style_class: 'tray-overflow-box',
            layout_manager: new Clutter.FlowLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                min_row_height: OVERFLOW_GRID_MIN_ROW_HEIGHT_PX,
                column_spacing: packing.spacing,
                row_spacing: packing.spacing,
                // updateGeometry pins the box to columns times the WIDEST
                // child. Equal cells make the layout fill exactly that box,
                // mixed real widths pack tighter and throw the height off.
                homogeneous: true,
            }),
            x_expand: false,
            y_expand: false,
            reactive: true,
            request_mode: Clutter.RequestMode.HEIGHT_FOR_WIDTH,
        });
    }

    get container() {
        return this._container;
    }

    get inlineActor() {
        return null;
    }

    updateGeometry(itemCount) {
        itemCount ??= this._container.get_children().filter(child => child.visible).length;

        if (itemCount === 0) {
            this._container.set_style(`${this._cachedBaseStyle} width: 0px; height: 0px;`);
            return;
        }

        // A foreign child is drawn by someone else and would stretch every
        // cell to its own width.
        const ownChildren = this._container.get_children()
            .filter(child => child.visible && !child[FOREIGN_ACTOR_PROP]);
        // The settings math sums padding and margin only, so a border or a
        // badge measures wider and FlowLayout then fits fewer per row than the
        // pinned width claims.
        const largestOf = measure => Math.max(...ownChildren.map(measure), 0);

        const [settingsWidth, settingsHeight] = this._settingsItemSize();
        const singleItemWidth = Math.max(settingsWidth, largestOf(child => child.get_preferred_width(-1)[1]));
        const singleItemHeight = Math.max(settingsHeight, largestOf(child => child.get_preferred_height(-1)[1]));

        const columns = this._columnCount(itemCount, singleItemWidth);
        const rows = Math.ceil(itemCount / columns);

        const {spacing, sidePadding, slack} = this._packing;
        let finalWidth = columns * singleItemWidth + (columns - 1) * spacing;
        let finalHeight = rows * singleItemHeight + (rows - 1) * spacing;

        finalWidth = Math.ceil(finalWidth) + slack;
        finalHeight = Math.ceil(finalHeight);

        let paddingLeft = sidePadding;
        let paddingRight = sidePadding;
        if (this._enableCustomStyle) {
            paddingLeft = this._settings.get_int('overflow-container-padding-left');
            paddingRight = this._settings.get_int('overflow-container-padding-right');
        }

        // Without max-width FlowLayout reports a one-row natural width and
        // the popup inflates.
        const geometryStyle =
            `width: ${finalWidth}px; min-width: ${finalWidth}px; max-width: ${finalWidth}px; ` +
            `height: ${finalHeight}px; min-height: ${finalHeight}px; max-height: ${finalHeight}px; ` +
            `padding-left: ${paddingLeft}px; padding-right: ${paddingRight}px;`;
        this._container.set_style(`${this._cachedBaseStyle} ${geometryStyle}`);

        this._container.queue_relayout();
    }

    // Mirrors computeTrayIconStyle in trayStyle.js so the box matches the
    // rendered icon size in the popup and the drawer alike.
    _settingsItemSize() {
        const iconSize = this._settings.get_int('icon-size');
        const enableCustomIcon = this._settings.get_boolean('enable-custom-icon-style');
        const sideSum = (property, sides, fallback) => enableCustomIcon
            ? sides.reduce((total, side) =>
                total + this._settings.get_int(`icon-${property}-${side}`), 0)
            : fallback;

        const horizontalButtonPadding = sideSum('padding', ['left', 'right'], DEFAULT_ICON_PADDING_PX * 2);
        const verticalButtonPadding = sideSum('padding', ['top', 'bottom'], DEFAULT_ICON_PADDING_PX * 2);
        const horizontalItemMargin = sideSum('margin', ['left', 'right'], ICON_MARGIN_PX * 2);
        const verticalItemMargin = sideSum('margin', ['top', 'bottom'], 0);
        return [
            iconSize + horizontalButtonPadding + horizontalItemMargin,
            iconSize + verticalButtonPadding + verticalItemMargin,
        ];
    }
}

export class OverflowMenu extends OverflowSurface {
    constructor(settings, toggleButton, onOpenStateChanged) {
        super(settings, onOpenStateChanged);
        this._toggleButton = toggleButton;

        this._attached = false;
        this._manager = null;
        this._customLayer = null;
        this._reopenPopupId = 0;

        this._menu = this._createMenu();
        this._menu.box.add_child(this._container);
    }

    _createMenu() {
        const configure = menu => {
            // The theme's .popup-menu rule pins a 15em min-width on the BoxPointer
            // actor, and _reposition centers that wrapper on the toggle, which
            // pushes the popup far left when the toggle sits in the left box.
            menu.actor.set_style(POPUP_UNCLAMP_CSS);

            // Without these, menu.box comes with x_expand=true and the popup spans the monitor.
            menu.box.x_expand = false;
            menu.box.y_expand = false;
            menu.box.set_style(POPUP_UNCLAMP_CSS);
            if (this._enableCustomStyle)
                menu.box.remove_style_class_name(MENU_CONTENT_STYLE_CLASS);
        };

        // Blur my Shell blurs any popup-menu-content box it finds among the
        // uiGroup children, over the full box and with its own radius. Without
        // the class it still finds the popup-menu actor there, hence the own layer.
        const parent = this._enableCustomStyle ? this._ensureCustomLayer() : Main.layoutManager.uiGroup;

        // The popup paints its own background from the user's settings.
        const menu = createPanelMenu(this._toggleButton, {configure, ownSurface: true, parent});

        menu.connect('open-state-changed', (_menu, isOpen) => {
            this._onOpenStateChanged(isOpen);
            if (!isOpen)
                return;
            this.updateGeometry();
            // The menu only raises itself inside its own parent
            if (parent === this._customLayer)
                Main.layoutManager.uiGroup.set_child_above_sibling(parent, null);
        });
        return menu;
    }

    _ensureCustomLayer() {
        if (!this._customLayer) {
            this._customLayer = new Clutter.Actor();
            Main.layoutManager.uiGroup.add_child(this._customLayer);
        }
        return this._customLayer;
    }

    get isOpen() {
        return this._menu.isOpen;
    }

    get isAttached() {
        return this._attached;
    }

    // Row mode asks for one line and grid mode for its configured columns,
    // but either can end up wider than the screen, and BoxPointer then clamps
    // the popup to a negative x where the leftmost icons can't be reached.
    _columnCount(itemCount, singleItemWidth) {
        const wanted = this._settings.get_string('overflow-layout-mode') === 'grid'
            ? this._settings.get_int('grid-column-limit')
            : itemCount;

        const monitor = Main.layoutManager.findMonitorForActor(this._toggleButton) ??
            Main.layoutManager.primaryMonitor;
        const budget = monitor ? monitor.width - OVERFLOW_SCREEN_MARGIN_PX : Infinity;
        const {spacing} = this._packing;
        const fits = Math.floor((budget + spacing) / (singleItemWidth + spacing));

        return Math.max(1, Math.min(itemCount, wanted, fits));
    }

    applyStyle() {
        const enableCustomStyle = this._settings.get_boolean('enable-custom-overflow-style');
        const isModeChange = enableCustomStyle !== this._enableCustomStyle;
        this._enableCustomStyle = enableCustomStyle;
        if (isModeChange)
            this._rebuildMenu();
        if (this._enableCustomStyle) {
            this._menu.box.set_style(`${POPUP_UNCLAMP_CSS} background-color: transparent; border: none; box-shadow: none; margin: 0; padding: 0;`);

            this._cachedBaseStyle = generateBoxStyle(this._settings, 'overflow-container', {
                minMargin: {left: CONTAINER_SIDE_MARGIN_MIN_PX, right: CONTAINER_SIDE_MARGIN_MIN_PX},
                light: popupUsesLightStyle(this._settings),
            });
        } else {
            this._menu.box.set_style(POPUP_UNCLAMP_CSS);
            this._cachedBaseStyle = '';
        }

        const blur = enableCustomStyle ? this._settings.get_int('overflow-container-blur') : 0;
        syncBackgroundBlur(this._container, blur);
        letBlurSeeThrough(this._menu.actor, blur > 0);

        // Without this the style only refreshes on the next geometry update.
        this.updateGeometry();
    }

    // Blur my Shell keeps blurring a menu it once found, until it is destroyed
    _rebuildMenu() {
        const wasAttached = this._attached;
        this._menu.box.remove_child(this._container);
        destroyMenuSafely(this._menu);
        this._menu = this._createMenu();
        this._menu.box.add_child(this._container);
        if (wasAttached)
            this.attachToManager();
    }

    attachToManager() {
        this._manager = panelMenuManagerFor(this._toggleButton);
        this._manager.addMenu(this._menu);
        this._attached = true;
    }

    // Close before detaching, removeMenu on an open menu only drops the
    // grab and the next emit would pop a modal that is already gone.
    detachFromManager() {
        if (this._menu.isOpen)
            this.close();
        this._manager?.removeMenu(this._menu);
        this._attached = false;
    }

    // The manager only takes its grab on the open transition, so a menu that
    // stayed open while detached has to restate its open state to get it back.
    // Closing and reopening would do it too, at the price of a flicker.
    restoreManagerGrab() {
        if (this._menu.isOpen)
            this._menu.emit('open-state-changed', true);
    }

    open() {
        this._menu.open(POPUP_ANIMATION_NONE);
    }

    close() {
        this._menu.close(POPUP_ANIMATION_NONE);
    }

    toggle() {
        this._menu.toggle();
    }

    afterIconClick(actor) {
        if (!keepsOverflowOpen(this._settings)) {
            if (this.isOpen)
                this.close();
            return;
        }
        if (!this._container.contains(actor))
            return;

        // The SNI action may shift focus, e.g. raise a window, which
        // drops Shell's modal grab and closes the popup.
        clearIds(this, removeTimer, '_reopenPopupId');

        this._reopenPopupId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._reopenPopupId = 0;
            if (!this.isOpen && keepsOverflowOpen(this._settings))
                this.open();

            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        clearIds(this, removeTimer, '_reopenPopupId');
        destroyMenuSafely(this._menu);
        this._customLayer?.destroy();
        this._menu = null;
        this._container = null;
        this._customLayer = null;
    }
}
