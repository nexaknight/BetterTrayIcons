import {drag, finishDrag} from './drag.js';
import {placeDemoWindow} from './heroLayout.js';
import {desktop, drawer, indicator, overflow, panel, toggle} from './elements.js';
import {positionPopup, renderApps, trayState} from './tray.js';
import {ui} from '../shared/store.js';
import {clamp} from '../shared/util.js';

const MAX_PANEL_ORDER = 20;
const MAX_GRID_COLUMNS = 10;
const MAX_VISIBLE = 20;
const NARROW_DESKTOP_PX = 440;
const TOGGLE_SIDES = ['left', 'right'];
const PANEL_BOXES = ['left', 'center', 'right'];
const LAYOUTS = ['grid', 'row'];
export const demo = {getState, update: updateDemo};

function getState() {
    return {...trayState, symbolic: desktop.classList.contains('symbolic')};
}

export function updateDemo(patch = {}) {
    if (drag)
        finishDrag(null, true);
    applyPatch(patch);
    overflow.classList.toggle('row', trayState.layout === 'row');
    placeIndicator();
    renderApps();
    notifyDemo();
}

function applyPatch(patch) {
    if (patch.panelOrder !== undefined)
        trayState.panelOrder = clamp(patch.panelOrder, 0, MAX_PANEL_ORDER);
    if (TOGGLE_SIDES.includes(patch.toggleSide))
        trayState.toggleSide = patch.toggleSide;
    if (PANEL_BOXES.includes(patch.panelPosition))
        trayState.panelPosition = patch.panelPosition;
    if (patch.visible !== undefined)
        trayState.visible = clamp(patch.visible, 0, MAX_VISIBLE);
    if (LAYOUTS.includes(patch.layout))
        trayState.layout = patch.layout;
    if (patch.gridColumns !== undefined)
        trayState.gridColumns = clamp(patch.gridColumns, 1, MAX_GRID_COLUMNS);
    if (patch.symbolic !== undefined)
        desktop.classList.toggle('symbolic', patch.symbolic);
}

function placeIndicator() {
    const box = document.querySelector(`#panel-${trayState.panelPosition}`);
    if (trayState.panelOrder === 0)
        box.prepend(indicator);
    else
        box.append(indicator);
    indicator.dataset.toggleSide = trayState.toggleSide;
    // The drawer sits on the far side of the visible icons, as in
    // src/shell/components/panelIndicator.js
    if (trayState.toggleSide === 'left') {
        indicator.prepend(toggle);
        indicator.append(drawer);
    } else {
        indicator.append(toggle);
        indicator.prepend(drawer);
    }
    drawer.dataset.edge = trayState.toggleSide === 'left' ? 'end' : 'start';
    panel.dataset.indicatorPosition = trayState.panelPosition;
    placeDemoWindow(trayState.panelPosition);
    positionPopup();
}

function notifyDemo() {
    document.dispatchEvent(new CustomEvent('bti-preview-change', {detail: getState()}));
}

// Below this the visible icons no longer fit next to the clock and the system
// indicator, so every icon goes to the overflow. The setting itself is kept.
export function fitPanel() {
    const isNarrow = desktop.clientWidth < NARROW_DESKTOP_PX;
    if (isNarrow === ui.isPanelNarrow) {
        positionPopup();
        return;
    }
    ui.isPanelNarrow = isNarrow;
    updateDemo();
}
