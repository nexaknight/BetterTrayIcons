import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {watchKeys} from '../../../shared/lifecycle.js';
import {clearChildren, createBox, ensurePrefsCss} from '../text.js';
import {
    SCENE_BAR_HEIGHT_PX, SCENE_SCREEN_HEIGHT_PX, createSceneDot, createScenePill, edgeChildren, translateTo,
} from './sceneInk.js';

const BAR_GAP_PX = 3;

// The workspace pill, the clock and the quick settings, what the shell puts on
// its bar by default.
const BOX_PILLS = Object.freeze({left: [16], center: [22], right: [18]});

const DOT_PX = 6;
const DOT_GAP_PX = 2;

// Past this the dots crowd the box in a half-width card, the real limit goes to 20.
const DOT_CAP = 4;

// The drawer's own dots take that room, past one the card grows wider than its siblings
const DRAWER_DOT_CAP = 1;

const TRAY_KEYS = Object.freeze(['visible-icon-limit', 'toggle-position', 'display-mode']);

// The popup or the drawer holds icons, three stand for however many overflow.
const OVERFLOW_DOTS = 3;
const POPUP_GAP_PX = 3;
const POPUP_EDGE_PX = 4;

export function buildPanelBoxScene(settings, box, mode = null) {
    const isDrawer = () => (mode ?? settings.get_string('display-mode')) === 'drawer';
    ensurePrefsCss();
    const layout = new PanelSceneLayout();
    const screen = new Gtk.Box({hexpand: true, vexpand: true, height_request: SCENE_SCREEN_HEIGHT_PX, layout_manager: layout});

    const bar = new Gtk.CenterBox({
        valign: Gtk.Align.START,
        height_request: SCENE_BAR_HEIGHT_PX,
        css_classes: ['bti-scene-bar'],
    });
    const [left, center, right] = Object.entries(BOX_PILLS).map(([name, pills]) => {
        const group = createBox({orientation: 'horizontal', spacing: BAR_GAP_PX, valign: 'center'});
        for (const width of pills)
            group.append(createScenePill({width_request: width}));
        if (name === box)
            _placeTray(group, _createTray(settings, isDrawer, toggle => layout.setAnchor(screen, toggle)), settings);
        return group;
    });
    bar.set_start_widget(left);
    bar.set_center_widget(center);
    bar.set_end_widget(right);

    const popup = _createOverflowDots('bti-scene-popup');
    watchKeys(popup, settings, ['display-mode'], () => (popup.visible = !isDrawer()));

    screen.append(bar);
    screen.append(popup);
    return screen;
}

function _createOverflowDots(cssClass) {
    const box = createBox({orientation: 'horizontal', spacing: DOT_GAP_PX, cssClasses: [cssClass]});
    for (let i = 0; i < OVERFLOW_DOTS; i++)
        box.append(createSceneDot('bti-scene-dot', DOT_PX));
    return box;
}

// Position 0 puts the tray in front of what the box already holds, any
// higher position after it.
function _placeTray(group, tray, settings) {
    const lastPill = group.get_last_child();
    group.append(tray);
    watchKeys(group, settings, ['tray-order'],
        () => group.reorder_child_after(tray, settings.get_int('tray-order') === 0 ? null : lastPill));
}

function _createTray(settings, isDrawer, onToggle) {
    const tray = createBox({orientation: 'horizontal', spacing: DOT_GAP_PX, valign: 'center'});

    const sync = () => {
        clearChildren(tray);
        const count = Math.min(settings.get_int('visible-icon-limit'), isDrawer() ? DRAWER_DOT_CAP : DOT_CAP);
        const dots = Array.from({length: count}, () => createSceneDot('bti-scene-dot', DOT_PX));
        const toggle = createSceneDot('bti-scene-toggle', DOT_PX);
        const inner = isDrawer() ? [...dots, _createOverflowDots('bti-scene-drawer')] : dots;
        const parts = settings.get_string('toggle-position') === 'left' ? [toggle, ...inner] : [...inner.reverse(), toggle];
        // The drawer's border makes the row taller, the dots keep their round
        parts.forEach(part => {
            part.valign = Gtk.Align.CENTER;
            tray.append(part);
        });
        onToggle(toggle);
    };
    watchKeys(tray, settings, TRAY_KEYS, sync);

    return tray;
}

// Hangs the overflow popup below the bar under the toggle, as the shell opens
// it, and keeps it inside the drawing on a narrow card.
const PanelSceneLayout = GObject.registerClass({GTypeName: 'BetterTrayIconsPanelSceneLayout'},
    class PanelSceneLayout extends Gtk.LayoutManager {
        setAnchor(widget, toggle) {
            this._anchor = toggle;
            widget.queue_allocate();
        }

        vfunc_get_request_mode(_widget) {
            return Gtk.SizeRequestMode.CONSTANT_SIZE;
        }

        vfunc_measure(widget, orientation, _forSize) {
            const [bar, popup] = edgeChildren(widget);
            const [barMin, barNat] = bar.measure(orientation, -1);
            if (!popup.visible)
                return [barMin, barNat, -1, -1];
            const [popupMin, popupNat] = popup.measure(orientation, -1);
            if (orientation === Gtk.Orientation.HORIZONTAL)
                return [Math.max(barMin, popupMin), Math.max(barNat, popupNat), -1, -1];
            return [barMin + POPUP_GAP_PX + popupMin, barNat + POPUP_GAP_PX + popupNat, -1, -1];
        }

        vfunc_allocate(widget, width, _height, _baseline) {
            const [bar, popup] = edgeChildren(widget);
            const [, barHeight] = bar.measure(Gtk.Orientation.VERTICAL, width);
            bar.allocate(width, barHeight, -1, null);
            if (!popup.visible)
                return;

            const [, popupWidth] = popup.measure(Gtk.Orientation.HORIZONTAL, -1);
            const [, popupHeight] = popup.measure(Gtk.Orientation.VERTICAL, popupWidth);
            const [hasAnchor, anchor] = this._anchor?.compute_bounds(widget) ?? [false];
            const center = hasAnchor ? anchor.get_x() + anchor.get_width() / 2 : width / 2;
            const maxX = Math.max(POPUP_EDGE_PX, width - popupWidth - POPUP_EDGE_PX);
            const x = Math.min(Math.max(center - popupWidth / 2, POPUP_EDGE_PX), maxX);
            popup.allocate(popupWidth, popupHeight, -1, translateTo(Math.round(x), barHeight + POPUP_GAP_PX));
        }
    });
