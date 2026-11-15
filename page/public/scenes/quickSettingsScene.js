import {sceneDots, scenePill} from './panelScene.js';

// buildQuickSettingsScene in src/prefs/components/scenes/quickSettingsScene.js
const BAR_PILL_WIDTH_PX = 18;
const BUTTONS_PER_COLUMN = 2;
const APP_ROWS = 4;
const UNFOLDED_APP_ROWS = 2;
const SUB_LINES = 3;
const POPUP_LINES = 3;

// Without a menu style the drawing shows the tray block alone, as the mode card does
export function quickSettingsScene(menuStyle = '') {
    const isUnfolded = menuStyle === 'inline';
    const buttons = `<span>${sceneButtons(BUTTONS_PER_COLUMN)}</span><span>${sceneButtons(BUTTONS_PER_COLUMN)}</span>`;
    const appRows = Array.from({length: isUnfolded ? UNFOLDED_APP_ROWS : APP_ROWS}, (_, i) => {
        const sub = isUnfolded && i === 0 ? `<span class="pref-scene-sub">${sceneLines(SUB_LINES)}</span>` : '';
        return `<span class="pref-scene-qs-row">${sceneDots(1)}<i class="pref-scene-line"></i></span>${sub}`;
    }).join('');
    // Inside the list so it centres on it, as SidePopupLayout anchors it
    const sidePopup = menuStyle === 'popup' ? `<span class="pref-scene-side-popup">${sceneLines(POPUP_LINES)}</span>` : '';
    return `<span class="pref-scene-bar"><span class="pref-scene-box right">${scenePill(BAR_PILL_WIDTH_PX)}</span></span>` +
        `<span class="pref-scene-qs"><span class="pref-scene-qs-buttons">${buttons}</span><i class="pref-scene-qs-slider"></i>` +
        '<span class="pref-scene-qs-tiles"><i class="on"></i><i></i><i></i><i class="on"></i></span>' +
        `<span class="pref-scene-qs-apps"><i class="pref-scene-line header"></i>${appRows}${sidePopup}</span></span>`;
}

function sceneButtons(count) {
    return '<i class="pref-scene-qs-button"></i>'.repeat(count);
}

function sceneLines(count) {
    return '<i class="pref-scene-line"></i>'.repeat(count);
}
