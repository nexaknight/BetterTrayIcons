import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {disposeAll} from '../shared/lifecycle.js';
import {generateBoxStyle} from './utils/actor.js';
import {ITEM_SPACING_PX, ICON_MARGIN_PX, OVERFLOW_GRID_MIN_ROW_HEIGHT_PX} from '../const.js';

// Owns the overflow PopupMenu and its container. PanelIndicator delegates
// positioning, container recreation and geometry here.
export class OverflowMenu {
    constructor(settings, toggleButton, onOpenStateChanged) {
        this._settings = settings;
        this._toggleButton = toggleButton;
        this._onOpenStateChanged = onOpenStateChanged;

        this._cachedBaseStyle = '';
        this._enableCustomStyle = false;

        this._currentLayoutMode = settings.get_string('overflow-layout-mode');
        this._lastColumnLimit = settings.get_int('grid-column-limit');

        this._menu = new PopupMenu.PopupMenu(this._toggleButton, 0.5, St.Side.TOP);
        this._menu.actor.add_style_class_name('panel-menu');

        // The theme's .popup-menu rule pins a 15em min-width on the BoxPointer actor.
        // BoxPointer._reposition then centers that 240px wrapper on the toggle and
        // clamps to the work-area, which pushes the popup far left when the toggle
        // sits in the left panel box. Forcing min-width: 0 on both actor and box
        // lets the wrapper shrink to the container width so the arrow ends up
        // over the toggle.
        this._menu.actor.set_style('min-width: 0; min-height: 0;');

        // Without these, menu.box inherits x_expand=true and the popup spans the monitor.
        if (this._menu.box) {
            this._menu.box.x_expand = false;
            this._menu.box.y_expand = false;
            this._menu.box.set_style('min-width: 0; min-height: 0;');
        }

        Main.layoutManager.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();

        this._menu.connect('open-state-changed', (menu, isOpen) => {
            if (this._onOpenStateChanged)
                this._onOpenStateChanged(isOpen);
            // BoxPointer's _reposition handles positioning automatically.
            if (isOpen)
                this.updateGeometry();
        });

        this.recreateContainer();
    }

    get menu() {
        return this._menu;
    }

    get container() {
        return this._container;
    }

    get layoutMode() {
        return this._currentLayoutMode;
    }

    get isOpen() {
        return this._menu?.isOpen;
    }

    recreateContainer() {
        if (this._container) {
            const children = this._container.get_children();
            children.forEach(child => this._container.remove_child(child));
            this._container.destroy();
            this._container = null;
        }

        const mode = this._settings.get_string('overflow-layout-mode');
        this._currentLayoutMode = mode;
        this._lastColumnLimit = this._settings.get_int('grid-column-limit');

        let layoutManager;

        if (mode === 'grid') {
            layoutManager = new Clutter.FlowLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                min_row_height: OVERFLOW_GRID_MIN_ROW_HEIGHT_PX,
                column_spacing: ITEM_SPACING_PX,
                row_spacing: ITEM_SPACING_PX,
                homogeneous: false,
            });
        } else {
            layoutManager = new Clutter.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                spacing: ITEM_SPACING_PX,
            });
        }

        this._container = new St.Widget({
            style_class: 'tray-overflow-box',
            layout_manager: layoutManager,
            x_expand: false,
            y_expand: false,
            reactive: true,
            request_mode: Clutter.RequestMode.HEIGHT_FOR_WIDTH,
        });

        if (this._menu && this._menu.box)
            this._menu.box.add_child(this._container);
    }

    // True when mode or grid-column-limit changed since the last build.
    layoutNeedsRecreate() {
        const mode = this._settings.get_string('overflow-layout-mode');
        const gridLimit = this._settings.get_int('grid-column-limit');
        return this._currentLayoutMode !== mode || (mode === 'grid' && this._lastColumnLimit !== gridLimit);
    }

    updateGeometry(itemCount) {
        if (!this._container)
            return;

        if (itemCount === undefined) {
            itemCount = 0;
            this._container.get_children().forEach(child => {
                if (child.visible)
                    itemCount++;
            });
        }

        if (itemCount === 0) {
            // Keep base style so visuals survive a re-open after empty.
            this._container.set_style(`${this._cachedBaseStyle} width: 0px; height: 0px;`);
            return;
        }

        const iconSize = this._settings.get_int('icon-size');
        const btnPadH = this._settings.get_int('icon-padding-horizontal') * 2;
        const btnPadV = this._settings.get_int('icon-padding-vertical') * 2;
        // Mirror the conditional ICON_MARGIN_PX from trayIcon.js so the
        // popup width matches the rendered icon size.
        const enableCustomIcon = this._settings.get_boolean('enable-custom-icon-style');
        const totalItemMargin = (enableCustomIcon ? 0 : ICON_MARGIN_PX) * 2;

        const singleItemWidth = iconSize + btnPadH + totalItemMargin;
        const singleItemHeight = iconSize + btnPadV;

        let finalWidth = 0;
        let finalHeight = 0;

        if (this._currentLayoutMode === 'grid') {
            let colLimit = this._settings.get_int('grid-column-limit');
            if (!colLimit || colLimit < 1)
                colLimit = 1;

            const columns = Math.min(itemCount, colLimit);
            const rows = Math.ceil(itemCount / columns);

            const contentWidth = columns * singleItemWidth;
            const spacingWidth = Math.max(0, columns - 1) * ITEM_SPACING_PX;
            finalWidth = contentWidth + spacingWidth;

            const contentHeight = rows * singleItemHeight;
            const spacingHeight = Math.max(0, rows - 1) * ITEM_SPACING_PX;
            finalHeight = contentHeight + spacingHeight;
        } else {
            const contentWidth = itemCount * singleItemWidth;
            const spacingWidth = Math.max(0, itemCount - 1) * ITEM_SPACING_PX;

            finalWidth = contentWidth + spacingWidth;
            finalHeight = singleItemHeight;
        }

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

        // min-width and max-width pin the popup width. Without max-width
        // FlowLayout reports a one-row natural width and the popup inflates.
        const geometryStyle =
            `width: ${finalWidth}px; min-width: ${finalWidth}px; max-width: ${finalWidth}px; ` +
            `height: ${finalHeight}px; min-height: ${finalHeight}px; max-height: ${finalHeight}px; ` +
            `padding-left: ${pLeft}px; padding-right: ${pRight}px;`;
        this._container.set_style(`${this._cachedBaseStyle} ${geometryStyle}`);

        this._container.queue_relayout();
        if (this._menu && this._menu.box)
            this._menu.box.queue_relayout();
    }

    applyStyle(enableCustomStyle) {
        this._enableCustomStyle = enableCustomStyle;
        if (!this._container || !this._menu)
            return;

        if (this._enableCustomStyle) {
            if (this._menu.box)
                this._menu.box.set_style('min-width: 0; min-height: 0; background-color: transparent; border: none; box-shadow: none; margin: 0; padding: 0;');

            // 1px left/right margin floor: with 0 the BoxPointer wrapper
            // collapses and the popup contents are clipped or hidden.
            this._cachedBaseStyle = generateBoxStyle(this._settings, 'overflow-container-', {
                minMargin: {left: 1, right: 1},
            });
        } else {
            // Leave menu.box's theme styling in place but still override the
            // .popup-menu min-width so the wrapper shrinks to our content.
            if (this._menu.box)
                this._menu.box.set_style('min-width: 0; min-height: 0;');
            this._cachedBaseStyle = '';
        }

        // Re-render now. Without this the style only refreshes on the next
        // geometry update.
        this.updateGeometry();
    }

    attachToManager() {
        if (Main.panel.menuManager)
            Main.panel.menuManager.addMenu(this._menu);
    }

    detachFromManager() {
        if (Main.panel.menuManager)
            Main.panel.menuManager.removeMenu(this._menu);
    }

    open() {
        this._menu?.open();
    }

    close() {
        this._menu?.close();
    }

    toggle() {
        this._menu?.toggle();
    }

    destroy() {
        if (this._menu)
            Main.panel.menuManager?.removeMenu(this._menu);
        disposeAll(this, 'destroy', '_menu');
        this._container = null;
    }
}
