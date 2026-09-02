import Gtk from 'gi://Gtk';

import {connectScoped} from '../../../shared/lifecycle.js';
import {clearChildren, createBox, ensurePrefsCss} from '../text.js';

const SCREEN_HEIGHT_PX = 96;

const BAR_HEIGHT_PX = 16;
const BAR_GAP_PX = 3;
const PILL_HEIGHT_PX = 5;

// The workspace pill, the clock and the quick settings, what the shell puts on
// its bar by default.
const BOX_PILLS = Object.freeze({left: [16], center: [22], right: [18]});

const DOT_PX = 6;
const DOT_GAP_PX = 2;

// Past this the dots push the clock off centre, the real limit goes to 20.
const DOT_CAP = 6;

const TRAY_KEYS = Object.freeze(['visible-icon-limit', 'toggle-position']);

export function buildPanelBoxScene(settings, box) {
    ensurePrefsCss();
    const screen = createBox({hexpand: true, vexpand: true, height_request: SCREEN_HEIGHT_PX});

    const bar = new Gtk.CenterBox({
        valign: Gtk.Align.START,
        height_request: BAR_HEIGHT_PX,
        css_classes: ['bti-scene-bar'],
    });
    const [left, center, right] = Object.entries(BOX_PILLS).map(([name, pills]) => {
        const group = createBox({orientation: 'horizontal', spacing: BAR_GAP_PX, valign: 'center'});
        if (name === box)
            group.append(_createTray(settings));
        for (const width of pills)
            group.append(createBox({cssClasses: ['bti-scene-pill'], width_request: width, height_request: PILL_HEIGHT_PX}));
        return group;
    });
    bar.set_start_widget(left);
    bar.set_center_widget(center);
    bar.set_end_widget(right);

    screen.append(bar);
    return screen;
}

function _createTray(settings) {
    const tray = createBox({orientation: 'horizontal', spacing: DOT_GAP_PX, valign: 'center'});

    const sync = () => {
        clearChildren(tray);
        const count = Math.min(settings.get_int('visible-icon-limit'), DOT_CAP);
        const dots = Array.from({length: count}, () => _createDot('bti-scene-dot'));
        const toggle = _createDot('bti-scene-toggle');
        const parts = settings.get_string('toggle-position') === 'left' ? [toggle, ...dots] : [...dots, toggle];
        parts.forEach(part => tray.append(part));
    };
    TRAY_KEYS.forEach(key => connectScoped(tray, settings, `changed::${key}`, sync));
    sync();

    return tray;
}

function _createDot(cssClass) {
    return createBox({cssClasses: [cssClass], width_request: DOT_PX, height_request: DOT_PX});
}
