import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {createBox, ensurePrefsCss} from '../text.js';
import {
    SCENE_BAR_HEIGHT_PX, SCENE_SCREEN_HEIGHT_PX, createSceneDot, createScenePill, edgeChildren, translateTo,
} from './sceneInk.js';

const BAR_PILL_WIDTH_PX = 18;

const MENU_WIDTH_PX = 92;
const MENU_EDGE_PX = 4;
const MENU_END_PX = 8;
const MENU_GAP_PX = 3;

const BUTTON_PX = 6;
const SLIDER_HEIGHT_PX = 4;
const TILE_HEIGHT_PX = 6;

const TILE_ROWS = Object.freeze([[true, false], [false, true]]);

const APP_ROWS = 4;
const UNFOLDED_APP_ROWS = 2;
const APP_ICON_PX = 4;
const APP_ROW_GAP_PX = 2;
const APPS_PADDING_PX = 3;
const HEADER_WIDTH_PX = 22;
const LINE_HEIGHT_PX = 2;
const SUB_LINES = 3;

const POPUP_LINES = 3;
const SIDE_POPUP_WIDTH_PX = 34;

// Without a menu style the drawing shows the tray block alone, as the mode
// card does.
export function buildQuickSettingsScene(menuStyle = null) {
    ensurePrefsCss();
    const screen = createBox({hexpand: true, vexpand: true, height_request: SCENE_SCREEN_HEIGHT_PX});

    const bar = createBox({
        orientation: 'horizontal',
        halign: 'fill',
        height_request: SCENE_BAR_HEIGHT_PX,
        cssClasses: ['bti-scene-bar'],
    });
    const quickSettings = createScenePill({
        width_request: BAR_PILL_WIDTH_PX,
        halign: 'end',
        valign: 'center',
        hexpand: true,
    });
    bar.append(quickSettings);
    screen.append(bar);

    const menu = createBox({
        spacing: MENU_GAP_PX,
        width_request: MENU_WIDTH_PX,
        cssClasses: ['bti-scene-qs'],
    });
    menu.append(_createButtons());
    menu.append(createBox({cssClasses: ['bti-scene-qs-slider'], height_request: SLIDER_HEIGHT_PX}));
    menu.append(_createTiles());
    const apps = _createBackgroundApps(menuStyle === 'inline');
    menu.append(apps);

    // The menu fills the height below the bar, so its gap to the bar and to
    // the bottom edge stays the same however tall the card gets.
    const stageProps = {
        halign: Gtk.Align.END,
        vexpand: true,
        margin_top: MENU_EDGE_PX,
        margin_bottom: MENU_EDGE_PX,
        margin_end: MENU_END_PX,
    };
    const isSidePopup = menuStyle === 'popup';
    const stage = isSidePopup
        ? new Gtk.Box({layout_manager: new SidePopupLayout(apps), ...stageProps})
        : new Gtk.Box({spacing: MENU_GAP_PX, ...stageProps});
    if (isSidePopup) {
        const popup = _createLines(POPUP_LINES, {cssClasses: ['bti-scene-popup']});
        popup.width_request = SIDE_POPUP_WIDTH_PX;
        stage.append(popup);
    }
    stage.append(menu);
    screen.append(stage);

    return screen;
}

function _createButtons() {
    const row = new Gtk.CenterBox();
    const start = createBox({orientation: 'horizontal', spacing: MENU_GAP_PX});
    const end = createBox({orientation: 'horizontal', spacing: MENU_GAP_PX});
    [start, start, end, end].forEach(side => side.append(createSceneDot('bti-scene-qs-button', BUTTON_PX)));
    row.set_start_widget(start);
    row.set_end_widget(end);
    return row;
}

function _createTiles() {
    const grid = createBox({spacing: MENU_GAP_PX});
    for (const lit of TILE_ROWS) {
        const row = createBox({orientation: 'horizontal', spacing: MENU_GAP_PX, homogeneous: true});
        lit.forEach(isOn => row.append(createBox({
            cssClasses: isOn ? ['bti-scene-qs-tile', 'on'] : ['bti-scene-qs-tile'],
            height_request: TILE_HEIGHT_PX,
            hexpand: true,
        })));
        grid.append(row);
    }
    return grid;
}

// The Background Apps list as it looks open, a header and one row per item with
// its icon and title. Unfolded, the first row shows its menu underneath.
function _createBackgroundApps(isUnfolded) {
    const block = createBox({vexpand: true, cssClasses: ['bti-scene-qs-row']});
    const content = createBox({
        spacing: APP_ROW_GAP_PX,
        margin_top: APPS_PADDING_PX,
        margin_bottom: APPS_PADDING_PX,
        margin_start: APPS_PADDING_PX,
        margin_end: APPS_PADDING_PX,
    });
    content.append(_createLine({halign: 'start', width_request: HEADER_WIDTH_PX}));
    const rowCount = isUnfolded ? UNFOLDED_APP_ROWS : APP_ROWS;
    for (let i = 0; i < rowCount; i++) {
        content.append(_createAppRow());
        if (isUnfolded && i === 0)
            content.append(_createLines(SUB_LINES, {cssClasses: ['bti-scene-qs-inline']}));
    }
    block.append(content);
    return block;
}

function _createAppRow() {
    const row = createBox({orientation: 'horizontal', spacing: APPS_PADDING_PX});
    const icon = createSceneDot('bti-scene-dot', APP_ICON_PX);
    icon.valign = Gtk.Align.CENTER;
    row.append(icon);
    row.append(_createLine({hexpand: true, valign: 'center'}));
    return row;
}

// The side popup opens left of Quick Settings, level with the middle of the
// Background Apps list as the real one opens beside its row.
const SidePopupLayout = GObject.registerClass(
    {GTypeName: 'BetterTrayIconsSidePopupLayout'},
    class SidePopupLayout extends Gtk.LayoutManager {
        _init(anchor) {
            super._init();
            this._anchor = anchor;
        }

        vfunc_measure(widget, orientation, _forSize) {
            const [popup, menu] = edgeChildren(widget);
            const [popupMin, popupNat] = popup.measure(orientation, -1);
            const [menuMin, menuNat] = menu.measure(orientation, -1);
            if (orientation === Gtk.Orientation.HORIZONTAL)
                return [popupMin + MENU_GAP_PX + menuMin, popupNat + MENU_GAP_PX + menuNat, -1, -1];
            return [Math.max(popupMin, menuMin), Math.max(popupNat, menuNat), -1, -1];
        }

        vfunc_allocate(widget, width, height, _baseline) {
            const [popup, menu] = edgeChildren(widget);
            const [, popupWidth] = popup.measure(Gtk.Orientation.HORIZONTAL, -1);
            const [, popupHeight] = popup.measure(Gtk.Orientation.VERTICAL, popupWidth);
            const menuX = popupWidth + MENU_GAP_PX;
            menu.allocate(width - menuX, height, -1, translateTo(menuX, 0));

            const [, anchor] = this._anchor.compute_bounds(widget);
            const y = anchor.get_y() + (anchor.get_height() - popupHeight) / 2;
            popup.allocate(popupWidth, popupHeight, -1, translateTo(0, Math.round(y)));
        }
    });

function _createLines(count, boxProps) {
    const box = createBox({spacing: MENU_GAP_PX, ...boxProps});
    for (let i = 0; i < count; i++)
        box.append(_createLine());
    return box;
}

function _createLine(props = {}) {
    return createScenePill({height_request: LINE_HEIGHT_PX, ...props});
}
