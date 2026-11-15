import {state} from '../shared/store.js';

// DOT_CAP, DRAWER_DOT_CAP and OVERFLOW_DOTS in src/prefs/components/scenes/panelScene.js
const MAX_SCENE_DOTS = 4;
const DRAWER_DOT_CAP = 1;
const SCENE_OVERFLOW_DOTS = 3;

export const PANEL_BOXES = [
    {box: 'left', label: 'Left', pillWidth: 16},
    {box: 'center', label: 'Center', pillWidth: 22},
    {box: 'right', label: 'Right', pillWidth: 18},
];

export function panelScene(trayBox, mode) {
    const boxes = PANEL_BOXES.map(({box, pillWidth}) => {
        const pill = scenePill(pillWidth);
        if (box !== trayBox)
            return `<span class="pref-scene-box ${box}">${pill}</span>`;
        const tray = sceneTray(mode);
        return `<span class="pref-scene-box ${box}">${state.panelOrder === 0 ? tray + pill : pill + tray}</span>`;
    }).join('');
    const popup = mode === 'popup' ? `<span class="pref-scene-popup ${trayBox}">${sceneDots(SCENE_OVERFLOW_DOTS)}</span>` : '';
    return `<span class="pref-scene-bar">${boxes}</span>${popup}`;
}

function sceneTray(mode) {
    const cap = mode === 'drawer' ? DRAWER_DOT_CAP : MAX_SCENE_DOTS;
    const dots = sceneDots(Math.min(state.visible, cap));
    const inner = mode === 'drawer' ? `${dots}<span class="pref-scene-drawer">${sceneDots(SCENE_OVERFLOW_DOTS)}</span>` : dots;
    const toggle = '<i class="pref-scene-toggle"></i>';
    return `<span class="pref-scene-tray">${state.toggleSide === 'left' ? toggle + inner : inner + toggle}</span>`;
}

export function scenePill(width) {
    return `<i class="pref-scene-pill" style="width:${width}px"></i>`;
}

export function sceneDots(count) {
    return '<i class="pref-scene-dot"></i>'.repeat(count);
}
