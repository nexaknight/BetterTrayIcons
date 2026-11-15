import {demo} from '../landing/demoState.js';
import {drawerSettled} from '../landing/drawer.js';
import {desktop, toggle as trayToggle} from '../landing/elements.js';
import {placeDemoWindow} from '../landing/heroLayout.js';
import {isTrayOpen, renderApps, setPopupOpen, syncToggleIcon} from '../landing/tray.js';
import {refreshApps, renderQuickSettings} from '../components/quickSettings.js';
import {APP_FIELD_KEY, TOGGLE_ICON_KEYS, drawerKey, state} from './store.js';
import {STYLE_DEFAULTS} from './styleDefaults.js';
import {applyTrayTheme} from './trayTheme.js';
import {views} from './views.js';

const TOGGLE_FONT_SCALE = 0.6;
const MIN_TOGGLE_FONT_PX = 10;
const QUICK_SETTINGS_KEYS = ['qsVisibleRows', 'keepOpen', 'hideBackground', 'qsMenuStyle'];
// Keys that change how much room the tray spacing has, trayTheme.js clamps by it
const TRAY_LAYOUT_KEYS = ['iconSize', 'toggleSize', 'visible', 'layout', 'gridColumns'];
// An automatic badge size follows the icon size
const APP_LIST_KEYS = ['iconSize', 'backgroundProxy', 'hideBackground', 'wine'];

let isApplyingDemo = false;
let pendingPageRender = 0;
let displaySwitch = 0;

export function mirrorOnDesktop(key, value) {
    if (APP_FIELD_KEY.test(key) || APP_LIST_KEYS.includes(key))
        refreshApps();
    if (TOGGLE_ICON_KEYS.includes(key) || TOGGLE_ICON_KEYS.map(drawerKey).includes(key))
        syncToggleIcon();
    if (key === 'displayMode')
        switchDisplayMode();
    if (QUICK_SETTINGS_KEYS.includes(key))
        renderQuickSettings();
    if (key in STYLE_DEFAULTS || TRAY_LAYOUT_KEYS.includes(key))
        applyTrayTheme();
    if (key === 'iconSize')
        desktop.style.setProperty('--tray-size', `${value}px`);
    if (key === 'toggleSize')
        trayToggle.style.fontSize = `${Math.max(MIN_TOGGLE_FONT_PX, value * TOGGLE_FONT_SCALE)}px`;
}

// The open overflow moves into the new mode's container, a mode without one
// closes it. The drawer slides shut first, otherwise the popup would anchor
// to a toggle the closing strip still pushes aside.
async function switchDisplayMode() {
    const switchId = ++displaySwitch;
    const wasOpen = isTrayOpen();
    setPopupOpen(false);
    await drawerSettled();
    if (switchId !== displaySwitch)
        return;
    renderApps();
    setPopupOpen(wasOpen);
    applyTrayTheme();
    renderQuickSettings();
    placeDemoWindow();
}

export function applyDemo(patch) {
    isApplyingDemo = true;
    demo.update(patch);
    isApplyingDemo = false;
}

export function onDemoChange(event) {
    Object.assign(state, event.detail);
    if (isApplyingDemo || pendingPageRender)
        return;
    pendingPageRender = requestAnimationFrame(() => {
        pendingPageRender = 0;
        views.renderPage(true);
    });
}
