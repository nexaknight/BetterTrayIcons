import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {generateBoxStyle, popupUsesLightStyle} from '../trayStyle.js';
import {createPanelMenu, destroyMenuSafely} from '../popupMenus.js';
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

export class OverflowMenu {
    constructor(settings, toggleButton, onOpenStateChanged) {
        this._settings = settings;
        this._toggleButton = toggleButton;
        this._onOpenStateChanged = onOpenStateChanged;

        this._cachedBaseStyle = '';
        this._enableCustomStyle = false;
        this._attached = false;

        this._menu = createPanelMenu(this._toggleButton, menu => {
            // The theme's .popup-menu rule pins a 15em min-width on the BoxPointer
            // actor. BoxPointer._reposition then centers that wrapper on the toggle
            // and clamps to the work-area, which pushes the popup far left when the
            // toggle sits in the left panel box.
            menu.actor.set_style(POPUP_UNCLAMP_CSS);

            // Without these, menu.box comes with x_expand=true and the popup spans the monitor.
            menu.box.x_expand = false;
            menu.box.y_expand = false;
            menu.box.set_style(POPUP_UNCLAMP_CSS);
        });

        this._menu.connect('open-state-changed', (menu, isOpen) => {
            this._onOpenStateChanged(isOpen);
            if (isOpen)
                this.updateGeometry();
        });

        this._buildContainer();
    }

    get container() {
        return this._container;
    }

    get isOpen() {
        return this._menu.isOpen;
    }

    get isAttached() {
        return this._attached;
    }

    _buildContainer() {
        // Both modes flow. Row mode stays on one line by being handed a width
        // that fits, and wraps instead of running off the monitor when it can't.
        this._container = new St.Widget({
            style_class: 'tray-overflow-box',
            layout_manager: new Clutter.FlowLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                min_row_height: OVERFLOW_GRID_MIN_ROW_HEIGHT_PX,
                column_spacing: ITEM_SPACING_PX,
                row_spacing: ITEM_SPACING_PX,
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

        this._menu.box.add_child(this._container);
    }

    updateGeometry(itemCount) {
        itemCount ??= this._container.get_children().filter(child => child.visible).length;

        if (itemCount === 0) {
            this._container.set_style(`${this._cachedBaseStyle} width: 0px; height: 0px;`);
            return;
        }

        const iconSize = this._settings.get_int('icon-size');
        // Mirrors computeTrayIconStyle in trayStyle.js so the popup size matches
        // the rendered icon size.
        const enableCustomIcon = this._settings.get_boolean('enable-custom-icon-style');
        const sideSum = (property, sides, fallback) => enableCustomIcon
            ? sides.reduce((total, side) =>
                total + this._settings.get_int(`icon-${property}-${side}`), 0)
            : fallback;

        const horizontalButtonPadding = sideSum('padding', ['left', 'right'], DEFAULT_ICON_PADDING_PX * 2);
        const verticalButtonPadding = sideSum('padding', ['top', 'bottom'], DEFAULT_ICON_PADDING_PX * 2);
        const horizontalItemMargin = sideSum('margin', ['left', 'right'], ICON_MARGIN_PX * 2);
        const verticalItemMargin = sideSum('margin', ['top', 'bottom'], 0);

        // The settings math sums padding and margin only, so a border or a
        // badge measures wider and FlowLayout then fits fewer per row than the
        // pinned width claims.
        const shown = this._container.get_children().filter(child => child.visible);
        const largestOf = measure => Math.max(...shown.map(measure));

        const singleItemWidth = Math.max(iconSize + horizontalButtonPadding + horizontalItemMargin,
            largestOf(child => child.get_preferred_width(-1)[1]));
        const singleItemHeight = Math.max(iconSize + verticalButtonPadding + verticalItemMargin,
            largestOf(child => child.get_preferred_height(-1)[1]));

        const columns = this._columnCount(itemCount, singleItemWidth);
        const rows = Math.ceil(itemCount / columns);

        let finalWidth = columns * singleItemWidth + Math.max(0, columns - 1) * ITEM_SPACING_PX;
        let finalHeight = rows * singleItemHeight + Math.max(0, rows - 1) * ITEM_SPACING_PX;

        finalWidth = Math.ceil(finalWidth) + FLOW_WIDTH_SLACK_PX;
        finalHeight = Math.ceil(finalHeight);

        let paddingLeft = CONTAINER_STOCK_SIDE_PADDING_PX;
        let paddingRight = CONTAINER_STOCK_SIDE_PADDING_PX;
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
        this._menu.box.queue_relayout();
    }

    // Row mode asks for one line and grid mode for its configured columns,
    // but either can end up wider than the screen, and BoxPointer then clamps
    // the popup to a negative x where the leftmost icons can't be reached.
    _columnCount(itemCount, singleItemWidth) {
        const wanted = this._settings.get_string('overflow-layout-mode') === 'grid'
            ? Math.max(1, this._settings.get_int('grid-column-limit'))
            : itemCount;

        const monitor = Main.layoutManager.findMonitorForActor(this._toggleButton) ??
            Main.layoutManager.primaryMonitor;
        const budget = monitor ? monitor.width - OVERFLOW_SCREEN_MARGIN_PX : Infinity;
        const fits = Math.floor((budget + ITEM_SPACING_PX) / (singleItemWidth + ITEM_SPACING_PX));

        return Math.max(1, Math.min(itemCount, wanted, fits));
    }

    applyStyle(enableCustomStyle) {
        this._enableCustomStyle = enableCustomStyle;
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

        // Without this the style only refreshes on the next geometry update.
        this.updateGeometry();
    }

    attachToManager() {
        Main.panel.menuManager.addMenu(this._menu);
        this._attached = true;
    }

    detachFromManager() {
        Main.panel.menuManager.removeMenu(this._menu);
        this._attached = false;
    }

    // The manager only takes its grab on the open transition, so a menu that
    // stayed open while detached has to restate its open state to get the
    // grab back. Closing and reopening would do it too, at the price of a
    // visible flicker.
    restoreManagerGrab() {
        if (this._menu.isOpen)
            this._menu.emit('open-state-changed', true);
    }

    open() {
        this._menu.open();
    }

    close() {
        this._menu.close();
    }

    toggle() {
        this._menu.toggle();
    }

    destroy() {
        destroyMenuSafely(this._menu);
        this._menu = null;
        this._container = null;
    }
}
