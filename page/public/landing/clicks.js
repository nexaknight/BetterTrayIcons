import {REORDER_ACTION, activateDrag, beginDrag, drag} from './drag.js';
import {drawer, overflow} from './elements.js';
import {isDrawerMode, mainTray, setPopupOpen} from './tray.js';
import {runAction, runScroll} from './trayActions.js';
import {state} from '../shared/store.js';

// LONG_PRESS_TIMEOUT_MS and DOUBLE_CLICK_MAX_DELAY_MS in src/shell/features/clickController.js
const LONG_PRESS_MS = 600;
const DOUBLE_CLICK_MS = 250;
const MOUSE_BINDINGS = ['Left', 'Middle', 'Right'];
const XEMBED_ACTIONS = {trayLeft: 'Activate', trayRight: 'Open Menu', trayTouchTap: 'Activate', trayTouchLong: 'Open Menu'};
const MIDDLE_BUTTON = 1;

let press = null;
let lastClick = {target: null, binding: '', time: 0};
let singleTimer = 0;

// One controller for tray icons and the toggle button, the Actions page of
// the prefs demo names what each binding does
export function bindClicks(button, {prefix, app = null, tray = null, afterAction = null, openMenu = null}) {
    const target = {button, prefix, app, tray, afterAction, openMenu};
    button.addEventListener('pointerdown', event => onPress(event, target));
    button.addEventListener('pointerup', event => onRelease(event, target));
    button.addEventListener('wheel', event => onWheel(event, target), {passive: false});
    // The tap already ran its action on pointerup, the click the browser
    // makes up afterwards would land on whatever that action opened
    button.addEventListener('touchend', event => event.preventDefault(), {passive: false});
    button.addEventListener('keydown', event => onKey(event, target));
}

export function bindTrayButton(button, app) {
    bindClicks(button, {prefix: 'tray', app, tray: mainTray, afterAction: action => afterIconAction(button, action)});
}

// Drawer.afterIconClick in src/shell/components/drawer.js and keepsOverflowOpen
// in src/shell/popupMenus.js. Without keep-open the popup or drawer goes once
// the click runs, a menu included, as the panel's menu manager closes the
// popup when the icon's menu opens.
function afterIconAction(button, action) {
    const isInside = drawer.contains(button) || overflow.contains(button);
    const hasAction = action !== 'None' && action !== undefined;
    const keepsOpen = isDrawerMode() ? state.drawerRemember : state.keepOpen;
    if (isInside && hasAction && !keepsOpen)
        setPopupOpen(false);
}

function onPress(event, target) {
    const binding = event.pointerType === 'touch' ? 'Touch' : MOUSE_BINDINGS[event.button];
    if (!binding)
        return;
    if (event.button === MIDDLE_BUTTON)
        event.preventDefault();
    if (target.tray)
        beginDrag(event, target.app, target.button, target.tray);
    // Alternating buttons inside the window is two singles, not a double
    const isRepeat = lastClick.target === target && lastClick.binding === binding;
    const isDouble = isRepeat && event.timeStamp - lastClick.time < DOUBLE_CLICK_MS;
    clearTimeout(singleTimer);
    lastClick = {target, binding, time: event.timeStamp};
    press = {target, binding, pointerId: event.pointerId, clickCount: isDouble ? 2 : 1, isLong: false, timer: 0};
    if (!isDouble)
        press.timer = setTimeout(onLongPress, LONG_PRESS_MS);
}

function onLongPress() {
    press.isLong = true;
    const action = actionFor(press.target, press.binding, 'Long');
    if (action === REORDER_ACTION && drag)
        activateDrag();
    else
        runAction(action, press.target);
}

function onRelease(event, target) {
    if (press?.target !== target || event.pointerId !== press.pointerId)
        return;
    clearTimeout(press.timer);
    const {binding, clickCount, isLong} = press;
    press = null;
    const isOutside = !target.button.contains(document.elementFromPoint(event.clientX, event.clientY));
    if (isLong || drag?.active || isOutside)
        return;
    if (clickCount === 2) {
        runClick(actionFor(target, binding, 'Double'), target);
        return;
    }
    const single = actionFor(target, binding, 'Single');
    // A single click waits out the double-click window only while a double action is set
    if (actionFor(target, binding, 'Double') === 'None') {
        runClick(single, target);
        return;
    }
    singleTimer = setTimeout(() => runClick(single, target), DOUBLE_CLICK_MS);
}

function runClick(action, target) {
    lastClick.time = 0;
    runAction(action, target);
}

function actionFor({prefix, app}, binding, type) {
    const suffix = {Single: binding === 'Touch' ? 'Tap' : '', Double: 'Double', Long: 'Long'}[type];
    const key = `${prefix}${binding}${suffix}`;
    if (app?.isXembed)
        return xembedAction(key);
    return state[key];
}

// An XEmbed icon gets the raw click, the app answers it itself. Only the
// long press keeps reordering, which BTI does around the icon.
function xembedAction(key) {
    if (key === 'trayLeftLong' && state.trayLeftLong === REORDER_ACTION)
        return REORDER_ACTION;
    return XEMBED_ACTIONS[key] ?? 'None';
}

function onWheel(event, target) {
    if (runScroll(target, event.deltaY))
        event.preventDefault();
}

// Keyboard activation stands for a left click, the menu key for a right one
function onKey(event, target) {
    const isActivation = event.key === 'Enter' || event.key === ' ';
    const isMenuKey = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!isActivation && !isMenuKey)
        return;
    event.preventDefault();
    runAction(actionFor(target, isMenuKey ? 'Right' : 'Left', 'Single'), target);
}
