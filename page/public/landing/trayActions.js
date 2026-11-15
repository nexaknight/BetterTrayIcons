import {reducedMotion} from './elements.js';
import {sampleMenu} from './sampleMenus.js';
import {closePanelMenus, setOverflowOpen, wasOpenedByHover} from './panelMenus.js';
import {isTrayOpen, renderApps} from './tray.js';
import {toggleAppWindow} from '../components/appWindow.js';
import {contextMenuAnchor, openContextMenu} from '../components/contextMenu.js';
import {stage} from '../components/window.js';
import {apps} from '../shared/apps.js';
import {state} from '../shared/store.js';
import {_} from '../shared/i18n.js';
import {views} from '../shared/views.js';

const NUDGE_PX = 3;
const NUDGE_MS = 180;

// The action names the Actions page offers, so the page stays the one
// place that maps a binding to what happens
const ACTIONS = {
    'Activate': ({app, button}) => toggleAppWindow(app, button),
    // A Quick Settings row brings its own way to show a menu, side or inline
    'Open Menu': ({app, button, openMenu}) => {
        const items = sampleMenu(app, button);
        if (openMenu)
            openMenu(items);
        else
            openContextMenu(button, items, {look: app.isXembed ? 'win32' : ''});
    },
    'Toggle Menu': ({button}) => {
        if (!wasOpenedByHover(button) || !isTrayOpen())
            setOverflowOpen(!isTrayOpen());
    },
    'Cycle Icons': () => cycleIcons(1),
    'Action Menu': ({button}) => {
        if (!wasOpenedByHover(button) || contextMenuAnchor() !== button)
            openActionMenu(button);
    },
    'Open BTI Settings': openSettings,
};

export function runAction(action, target) {
    ACTIONS[action]?.(target);
    target.afterAction?.(action);
}

// Returns whether the wheel went somewhere, a wheel nobody takes scrolls the page
export function runScroll(target, deltaY) {
    if (target.prefix === 'toggle') {
        if (state.toggleScroll !== 'Cycle Icons')
            return false;
        cycleIcons(Math.sign(deltaY));
        return true;
    }
    if (scrollActionFor(target.app) !== 'Forward to the App')
        return false;
    nudge(target.button, Math.sign(deltaY));
    return true;
}

// Per-app Scroll in the app dialog overrides the Actions page
function scrollActionFor(app) {
    // An XEmbed window gets no wheel event from the tray
    if (app.isXembed)
        return 'None';
    const appScroll = state.appConfigs[app.id]?.scroll ?? 'default';
    if (appScroll === 'default')
        return state.trayScroll;
    return appScroll === 'forward' ? 'Forward to the App' : 'None';
}

function nudge(button, direction) {
    if (reducedMotion.matches)
        return;
    const offset = `translateY(${direction * NUDGE_PX}px)`;
    button.animate([{transform: 'none'}, {transform: offset}, {transform: 'none'}], {duration: NUDGE_MS});
}

function cycleIcons(direction) {
    if (direction < 0)
        apps.unshift(apps.pop());
    else
        apps.push(apps.shift());
    renderApps(true);
}

// The action menu replaces whatever panel menu is open, the overflow included
export function openActionMenu(button) {
    closePanelMenus('context');
    openContextMenu(button, actionMenu());
}

// The two items of _ensureActionMenu in src/shell/components/toggleButton.js
function actionMenu() {
    return [
        {label: state.displayMode === 'drawer' ? _('Open Drawer') : _('Open Overflow Menu'), onActivate: () => setOverflowOpen(true)},
        {label: _('Open BTI Settings'), onActivate: openSettings},
    ];
}

export function openSettings() {
    views.openPage('general');
    stage.scrollIntoView({behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center'});
}
