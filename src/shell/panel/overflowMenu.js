import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {generateBoxStyle, createPanelMenu, destroyMenuSafely} from '../utils/actor.js';
import {ITEM_SPACING_PX, ICON_MARGIN_PX, DEFAULT_ICON_PADDING_PX} from '../../const.js';

const OVERFLOW_GRID_MIN_ROW_HEIGHT_PX = 24;

// Keeps a wide overflow popup from being clamped flush against the screen edges.
const OVERFLOW_SCREEN_MARGIN_PX = 64;

const POPUP_UNCLAMP_CSS = 'min-width: 0; min-height: 0;';

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
            // toggle sits in the left panel box. min-width: 0 on both actor and box
            // lets the wrapper shrink to the container so the arrow lands on the toggle.
            menu.actor.set_style(POPUP_UNCLAMP_CSS);

            // Without these, menu.box inherits x_expand=true and the popup spans the monitor.
            if (menu.box) {
                menu.box.x_expand = false;
                menu.box.y_expand = false;
                menu.box.set_style(POPUP_UNCLAMP_CSS);
            }
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
        // Both modes flow: row mode stays on one line by being handed a width
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
                // mixed real widths packed tighter and left the height off.
                homogeneous: true,
            }),
            x_expand: false,
            y_expand: false,
            reactive: true,
            request_mode: Clutter.RequestMode.HEIGHT_FOR_WIDTH,
        });

        if (this._menu.box)
            this._menu.box.add_child(this._container);
    }

    updateGeometry(itemCount) {
        itemCount ??= this._container.get_children().filter(child => child.visible).length;

        if (itemCount === 0) {
            // Keep base style so visuals survive a re-open after empty.
            this._container.set_style(`${this._cachedBaseStyle} width: 0px; height: 0px;`);
            return;
        }

        const iconSize = this._settings.get_int('icon-size');
        // Mirrors computeTrayIconStyle in actor.js so the popup size matches
        // the rendered icon size: stock mode uses the fixed defaults, custom
        // mode uses the user's own padding/margin on every side.
        const enableCustomIcon = this._settings.get_boolean('enable-custom-icon-style');
        const btnPadH = enableCustomIcon
            ? this._settings.get_int('icon-padding-left') + this._settings.get_int('icon-padding-right')
            : DEFAULT_ICON_PADDING_PX * 2;
        const btnPadV = enableCustomIcon
            ? this._settings.get_int('icon-padding-top') + this._settings.get_int('icon-padding-bottom')
            : DEFAULT_ICON_PADDING_PX * 2;
        const totalItemMarginH = enableCustomIcon
            ? this._settings.get_int('icon-margin-left') + this._settings.get_int('icon-margin-right')
            : ICON_MARGIN_PX * 2;
        const totalItemMarginV = enableCustomIcon
            ? this._settings.get_int('icon-margin-top') + this._settings.get_int('icon-margin-bottom')
            : 0;

        // The shell theme adds its own padding to panel-button, so the settings
        // alone under-measure an item and FlowLayout then fits fewer per row
        // than the pinned width claims.
        const shown = this._container.get_children().filter(child => child.visible);
        const measured = size => shown.length ? Math.max(...shown.map(size)) : 0;

        const singleItemWidth = Math.max(iconSize + btnPadH + totalItemMarginH,
            measured(child => child.get_preferred_width(-1)[1]));
        const singleItemHeight = Math.max(iconSize + btnPadV + totalItemMarginV,
            measured(child => child.get_preferred_height(-1)[1]));

        const columns = this._columnCount(itemCount, singleItemWidth);
        const rows = Math.ceil(itemCount / columns);

        let finalWidth = columns * singleItemWidth + Math.max(0, columns - 1) * ITEM_SPACING_PX;
        let finalHeight = rows * singleItemHeight + Math.max(0, rows - 1) * ITEM_SPACING_PX;

        finalWidth = Math.ceil(finalWidth) + 1;
        finalHeight = Math.ceil(finalHeight);

        // Default mode floors padding at 1px so icons don't clip at the
        // popup-menu-content frame.
        let pLeft, pRight;
        if (this._enableCustomStyle) {
            pLeft = this._settings.get_int('overflow-container-padding-left');
            pRight = this._settings.get_int('overflow-container-padding-right');
        } else {
            pLeft = pRight = 1;
        }

        // Without max-width FlowLayout reports a one-row natural width and
        // the popup inflates.
        const geometryStyle =
            `width: ${finalWidth}px; min-width: ${finalWidth}px; max-width: ${finalWidth}px; ` +
            `height: ${finalHeight}px; min-height: ${finalHeight}px; max-height: ${finalHeight}px; ` +
            `padding-left: ${pLeft}px; padding-right: ${pRight}px;`;
        this._container.set_style(`${this._cachedBaseStyle} ${geometryStyle}`);

        this._container.queue_relayout();
        if (this._menu.box)
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
            if (this._menu.box)
                this._menu.box.set_style(`${POPUP_UNCLAMP_CSS} background-color: transparent; border: none; box-shadow: none; margin: 0; padding: 0;`);

            // 1px left/right margin floor: with 0 the BoxPointer wrapper
            // collapses and the popup contents are clipped or hidden.
            this._cachedBaseStyle = generateBoxStyle(this._settings, 'overflow-container-', {
                minMargin: {left: 1, right: 1},
            });
        } else {
            if (this._menu.box)
                this._menu.box.set_style(POPUP_UNCLAMP_CSS);
            this._cachedBaseStyle = '';
        }

        // Without this the style only refreshes on the next geometry update.
        this.updateGeometry();
    }

    attachToManager() {
        if (Main.panel.menuManager) {
            Main.panel.menuManager.addMenu(this._menu);
            this._attached = true;
        }
    }

    detachFromManager() {
        if (Main.panel.menuManager)
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
