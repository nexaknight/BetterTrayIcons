import {systemIndicator, toggle} from './elements.js';
import {isTrayOpen, setPopupOpen} from './tray.js';
import {closeContextMenu, contextMenuAnchor} from '../components/contextMenu.js';
import {isQuickSettingsOpen, setQuickSettingsOpen} from '../components/quickSettings.js';
import {state} from '../shared/store.js';

// One panel menu at a time, as the shell's PopupMenuManager keeps it. A
// click outside or a settings change leaves the overflow open on purpose,
// so its effect stays in view.
const MENUS = {
    overflow: {owner: () => toggle, isOpen: () => isTrayOpen(), close: () => setPopupOpen(false)},
    quickSettings: {owner: () => systemIndicator, isOpen: () => isQuickSettingsOpen(), close: () => setQuickSettingsOpen(false)},
    context: {owner: () => contextMenuAnchor(), isOpen: () => contextMenuAnchor() !== null, close: () => closeContextMenu()},
};

// The button whose menu the pointer just opened by hovering. The click that
// usually follows finds it open and leaves it that way.
let hoverOpener = null;

export function closePanelMenus(except) {
    for (const [name, menu] of Object.entries(MENUS)) {
        if (name !== except && menu.isOpen())
            menu.close();
    }
}

export function setOverflowOpen(shouldOpen) {
    if (shouldOpen)
        closePanelMenus('overflow');
    setPopupOpen(shouldOpen);
}

export function wasOpenedByHover(button) {
    const isSame = hoverOpener === button;
    hoverOpener = null;
    return isSame;
}

export function toggleQuickSettings() {
    if (wasOpenedByHover(systemIndicator) && isQuickSettingsOpen())
        return;
    const willOpen = !isQuickSettingsOpen();
    if (willOpen)
        closePanelMenus('quickSettings');
    setQuickSettingsOpen(willOpen);
}

// Moving onto another panel button while a menu is open switches to that
// button's menu, the toggle's per toggle-hover-menu in the schema. The
// drawer has no hover sibling, as Drawer.isAttached in
// src/shell/components/drawer.js says. The action menu comes from
// trayActions.js, which reaches the menus through this module.
export function bindHoverSwitching(openActionMenu) {
    // A finger has no hover, a tap opens a menu on its own
    toggle.addEventListener('pointerenter', event => {
        const canSwitch = event.pointerType === 'mouse' && isOtherMenuOpen(toggle) && state.displayMode === 'popup';
        if (!canSwitch)
            return;
        if (state.menuHover === 'Action Menu')
            openActionMenu(toggle);
        else
            setOverflowOpen(true);
        hoverOpener = toggle;
    });
    systemIndicator.addEventListener('pointerenter', event => {
        const canSwitch = event.pointerType === 'mouse' && isOtherMenuOpen(systemIndicator) && !isQuickSettingsOpen();
        if (!canSwitch)
            return;
        closePanelMenus('quickSettings');
        setQuickSettingsOpen(true);
        hoverOpener = systemIndicator;
    });
    for (const button of [toggle, systemIndicator])
        button.addEventListener('pointerleave', () => wasOpenedByHover(button));
}

function isOtherMenuOpen(button) {
    return Object.values(MENUS).some(menu => menu.isOpen() && menu.owner() !== button);
}
