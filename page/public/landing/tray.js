import {isDrawerOpen, setDrawerOpen} from './drawer.js';
import {desktop, drawer, drawerIcons, indicator, inline, overflow, overflowIcons, panel, reducedMotion, toggle} from './elements.js';
import {badgeMarkup} from './trayBadge.js';
import {layoutTray, setShownOrder} from './trayLayout.js';
import {toggleIconMarkup, toggleIconState} from '../shared/toggleIcon.js';
import {appIconMarkup, apps, displayName, isAppHidden, isAppPresent} from '../shared/apps.js';
import {schedulePersist} from '../shared/persist.js';
import {state as prefs, ui} from '../shared/store.js';
import {clamp} from '../shared/util.js';
import {_} from '../shared/i18n.js';
import {createButton} from '../components/button.js';

const ICON_CELL_PX = 32;
const ICON_PITCH_PX = 38;
// The popup stays this far inside the desktop
export const DESKTOP_INSET_PX = 40;
const POPUP_EDGE_PX = 12;
export const nodes = new Map();
// Starts from the store, which already holds what the last visit left
export const trayState = {visible: prefs.visible, layout: prefs.layout, toggleSide: prefs.toggleSide, panelPosition: prefs.panelPosition, gridColumns: prefs.gridColumns, panelOrder: prefs.panelOrder};

export const mainTray = {
    order: apps,
    shown: shownApps,
    nodes,
    inline,
    visibleCount: visibleInPanel,
    hiddenList: () => isDrawerMode() ? drawerIcons : overflowIcons,
    hiddenZone,
    render: renderApps,
    open: () => setPopupOpen(true),
};

function visibleInPanel() {
    return ui.isPanelNarrow ? 0 : trayState.visible;
}

function shownApps() {
    return apps.filter(app => isAppPresent(app) && !isAppHidden(app));
}

export function isDrawerMode() {
    return prefs.displayMode === 'drawer';
}

function hiddenZone() {
    if (isDrawerMode())
        return isDrawerOpen() ? drawer : null;
    return overflow.hidden ? null : overflow;
}

export function createTrayButton(app, tray = mainTray) {
    const button = createButton({variant: 'tray-icon', attributes: `data-app="${app.id}"`});
    button.style.setProperty('--app-color', app.color);
    nameTrayButton(button, app.name);
    button.setAttribute('aria-description', _('Drag to reorder. Hold Alt and press an arrow key to reorder with the keyboard.'));
    button.innerHTML = appIconMarkup(app, 'aria-hidden="true"');
    button.addEventListener('dragstart', event => event.preventDefault());
    button.addEventListener('keydown', event => onTrayKey(event, app, button, tray));
    return button;
}

function nameTrayButton(button, name) {
    button.setAttribute('aria-label', name);
    button.dataset.prefTooltip = name;
}

function onTrayKey(event, app, button, tray) {
    const isMoveKey = event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
    if (!isMoveKey)
        return;
    event.preventDefault();
    const shown = tray.shown();
    const index = shown.indexOf(app);
    const target = clamp(index + (event.key === 'ArrowRight' ? 1 : -1), 0, shown.length - 1);
    shown.splice(target, 0, shown.splice(index, 1)[0]);
    setShownOrder(tray, shown);
    tray.open();
    tray.render(true);
    button.focus();
}

export function renderApps(shouldAnimate = false) {
    schedulePersist();
    indicator.hidden = prefs.displayMode === 'background-apps';
    toggle.dataset.mode = prefs.displayMode;
    syncToggleIcon();
    // The app dialog renames and re-icons the hero tray, the miniature stays stock
    for (const app of apps) {
        const node = nodes.get(app.id);
        nameTrayButton(node, displayName(app));
        const markup = appIconMarkup(app, 'aria-hidden="true"') + badgeMarkup(app, prefs.iconSize);
        if (node.dataset.markup !== markup) {
            node.dataset.markup = markup;
            node.innerHTML = markup;
        }
    }
    layoutTray(mainTray, shouldAnimate);
    toggle.hidden = visibleInPanel() >= shownApps().length;
    if (toggle.hidden || indicator.hidden)
        setPopupOpen(false);
    positionPopup();
}

export function syncToggleIcon() {
    const {value, angle, isAnimated, duration, delay} = toggleIconState(isTrayOpen());
    if (toggle.dataset.icon !== value) {
        toggle.dataset.icon = value;
        toggle.innerHTML = toggleIconMarkup(value, 'tray-toggle-icon');
    }
    const iconElement = toggle.firstElementChild;
    const isMoving = isAnimated && !reducedMotion.matches;
    iconElement.style.transition = isMoving ? `transform ${duration}ms ease-out ${delay}ms` : 'none';
    iconElement.style.transform = angle ? `rotate(${angle}deg)` : '';
}

export function isTrayOpen() {
    return toggle.getAttribute('aria-expanded') === 'true';
}

// The popup and the drawer both answer to the toggle, the mode picks which
export function setPopupOpen(shouldOpen) {
    const isOpen = shouldOpen && visibleInPanel() < shownApps().length && !indicator.hidden;
    overflow.hidden = !isOpen || isDrawerMode();
    setDrawerOpen(isOpen && isDrawerMode());
    toggle.setAttribute('aria-expanded', String(isOpen));
    syncToggleIcon();
    schedulePersist();
    toggle.setAttribute('aria-controls', isDrawerMode() ? 'tray-drawer' : 'overflow');
    positionPopup();
}

export function positionPopup() {
    if (overflow.hidden)
        return;
    const count = Math.max(1, shownApps().length - visibleInPanel());
    const columns = trayState.layout === 'grid' ? Math.min(trayState.gridColumns, count) : count;
    const available = Math.max(1, Math.floor((desktop.clientWidth - DESKTOP_INSET_PX) / ICON_PITCH_PX));
    overflowIcons.style.gridTemplateColumns = `repeat(${Math.min(columns, available)},${ICON_CELL_PX}px)`;

    const bounds = desktop.getBoundingClientRect();
    const button = toggle.getBoundingClientRect();
    const width = overflow.offsetWidth;
    const centered = button.left - bounds.left + button.width / 2 - width / 2;
    overflow.style.left = `${clamp(centered, POPUP_EDGE_PX, bounds.width - width - POPUP_EDGE_PX)}px`;
    // The stacked hero keeps its title below the popup, _heroDesktop.scss reads this
    const panelBottom = panel.offsetTop + panel.offsetHeight;
    desktop.style.setProperty('--overflow-clearance', `${overflow.offsetTop + overflow.offsetHeight - panelBottom}px`);
}
