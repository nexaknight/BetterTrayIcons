import {refreshApps} from '../components/quickSettings.js';
import {paintRange} from '../components/range.js';
import {clearFilter} from '../components/search.js';
import {toast} from '../components/toast.js';
import {root} from '../components/window.js';
import {autoPush} from '../dialogs/syncDialog.js';
import {_} from './i18n.js';
import {applyDemo, mirrorOnDesktop} from './landingBridge.js';
import {APP_FIELD_KEY, APP_FIELD_NAMES, DEFAULT_ACTIONS, DEFAULT_STATE, DEMO_KEYS, TOGGLE_ICON_KEYS, drawerKey, state, toggleKey, ui} from './store.js';
import {styleKeysOf} from './styleDefaults.js';
import {applyTrayTheme} from './trayTheme.js';
import {clamp} from './util.js';
import {views} from './views.js';

const SLOW_STEP_KEYS = ['tooltipDelay', 'rotateDuration', 'rotateDelay'];
const SLOW_STEP = 50;
const DESKTOP_MIRROR_KEYS = ['iconSize', 'toggleSize', 'displayMode'];
// The rotation rows edit the popup's or the drawer's set, whichever is live
const ROTATION_KEYS = TOGGLE_ICON_KEYS.slice(2);

export const SUBPAGE_KEYS = {
    icons: ['symbolic', 'iconSize', ...styleKeysOf('icons')],
    toggle: ['toggleSize', 'toggleSide', ...styleKeysOf('toggle'), ...TOGGLE_ICON_KEYS, ...TOGGLE_ICON_KEYS.map(drawerKey)],
    overflow: ['layout', 'gridColumns', ...styleKeysOf('overflow')],
};

export const PAGE_KEYS = {
    general: ['displayMode', 'wine', 'keepOpen', 'failedClick', 'drawerRemember', 'hideBackground', 'backgroundProxy', 'tooltips', 'tooltipPosition', 'tooltipDelay', 'whenInFront'],
    appearance: ['panelPosition', 'panelOrder', 'visible', 'qsMenuStyle', 'qsVisibleRows', ...Object.values(SUBPAGE_KEYS).flat()],
    actions: Object.keys(DEFAULT_ACTIONS),
};

export const DIALOG_KEYS = {
    'tooltips': ['tooltipPosition', 'tooltipDelay'],
    'background': ['backgroundProxy'],
    'keep-open': ['failedClick'],
    'toggle-icon': [],
};

export function update(key, value) {
    state[key] = value;
    const appField = key.match(APP_FIELD_KEY);
    if (appField)
        state.appConfigs[appField[2]][APP_FIELD_NAMES[appField[1]]] = value;
    mirrorOnDesktop(key, value);
    if (!DEMO_KEYS.includes(key))
        state.syncPending = true;
    autoPush();
    if (key === 'showFilter' && !value)
        clearFilter();
    if (DEMO_KEYS.includes(key))
        applyDemo({[key]: value});
    views.renderPage(true);
    if (ui.dialogType)
        views.renderModal();
}

export function stepValue(button) {
    const key = button.dataset.prefStep;
    const step = SLOW_STEP_KEYS.includes(key) ? SLOW_STEP : 1;
    const value = state[key] + Number(button.dataset.delta) * step;
    update(key, clamp(value, Number(button.dataset.min), Number(button.dataset.max)));
}

// Dragging only moves the paired control and the live tray, a full render
// would drop the slider out from under the pointer
export function slideRange(input) {
    const key = input.dataset.prefRange;
    const value = clamp(Number(input.value) || 0, Number(input.min), Number(input.max));
    state[key] = value;
    for (const control of root.querySelectorAll(`[data-pref-range="${key}"]`)) {
        if (control !== input)
            control.value = value;
        if (control.type === 'range')
            paintRange(control);
    }
    mirrorOnDesktop(key, value);
}

export function dialogResetKeys() {
    const [kind, argument] = ui.dialogType.split(':');
    if (kind === 'action')
        return [`${argument}Tap`, `${argument}Double`, `${argument}Long`].filter(key => key in DEFAULT_ACTIONS);
    if (kind === 'toggle-icon')
        return ROTATION_KEYS.map(toggleKey);
    return DIALOG_KEYS[kind];
}

export function resetSettings(keys) {
    for (const key of keys)
        state[key] = structuredClone(DEFAULT_STATE[key]);
    afterReset();
}

export function factoryReset() {
    Object.assign(state, structuredClone(DEFAULT_STATE));
    delete state.sampleBackups;
    delete state.sampleSyncTime;
    delete state.syncPending;
    afterReset();
}

function afterReset() {
    applyDemo(Object.fromEntries(DEMO_KEYS.map(key => [key, state[key]])));
    for (const key of DESKTOP_MIRROR_KEYS)
        mirrorOnDesktop(key, state[key]);
    applyTrayTheme();
    views.renderPage(true);
    if (ui.dialogType)
        views.renderModal();
    toast(_('Settings reset'));
}

export function clearAppConfigs(message) {
    state.appConfigs = {};
    refreshApps();
    views.renderPage(true);
    toast(message);
}
