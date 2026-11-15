import {bindClicks, bindTrayButton} from './landing/clicks.js';
import {startClock} from './landing/clock.js';
import {openCompatDialog} from './landing/compatDialog.js';
import {onKonamiKey} from './landing/konami.js';
import {fitPanel, updateDemo} from './landing/demoState.js';
import {drag, finishDrag, moveDrag} from './landing/drag.js';
import {desktop, indicator, systemIndicator, toggle} from './landing/elements.js';
import {setUpMiniTray} from './landing/miniTray.js';
import {bindHoverSwitching, toggleQuickSettings} from './landing/panelMenus.js';
import {translateDocument} from './landing/translateDocument.js';
import {createTrayButton, isTrayOpen, nodes, positionPopup, renderApps, setPopupOpen} from './landing/tray.js';
import {openActionMenu, openSettings} from './landing/trayActions.js';
import {bindQuickSettings, quickSettingsSnapshot, setQuickSettingsOpen} from './components/quickSettings.js';
import {apps} from './shared/apps.js';
import {mirrorOnDesktop} from './shared/landingBridge.js';
import {bindPersistence, isStoredDrawerOpen, state as prefs, storedExpanders} from './shared/store.js';
import {applyTrayTheme} from './shared/trayTheme.js';
import {openInstallGuide} from './landing/installGuide.js';
import {bindExpanders, openExpanderIds, restoreExpanders} from './components/expander.js';
import {bindMarkdownViews} from './components/markdown.js';
import {bindOverlayScrollbars} from './shared/overlayScrollbars.js';

const donateMenu = document.querySelector('#donate-menu');

translateDocument();

for (const app of apps) {
    const button = createTrayButton(app);
    bindTrayButton(button, app);
    nodes.set(app.id, button);
}

document.addEventListener('pointermove', moveDrag, {passive: false});
document.addEventListener('pointerup', event => finishDrag(event));
document.addEventListener('pointercancel', event => finishDrag(event, true));
document.addEventListener('keydown', onEscape);
document.addEventListener('keydown', onKonamiKey, true);
// No browser menu anywhere, right-click on tray icons opens our own from clicks.js
document.addEventListener('contextmenu', event => event.preventDefault());

globalThis.addEventListener('blur', () => {
    if (drag)
        finishDrag(null, true);
});

renderApps();
bindClicks(toggle, {prefix: 'toggle'});
fitPanel();
globalThis.addEventListener('resize', fitPanel);
globalThis.addEventListener('resize', applyTrayTheme);
document.fonts.ready.then(positionPopup);
const popupAnchors = new ResizeObserver(() => positionPopup());
popupAnchors.observe(indicator);
popupAnchors.observe(desktop);

const tickPanelClock = startClock(document.querySelector('#panel-clock'));

document.addEventListener('visibilitychange', () => {
    if (!document.hidden)
        tickPanelClock();
});

updateDemo({symbolic: prefs.symbolic});
// The stored settings reach the desktop before anything else draws. The
// overflow opens as the page always has, the drawer only when remembered.
for (const key of ['iconSize', 'toggleSize'])
    mirrorOnDesktop(key, prefs[key]);
applyTrayTheme();
setPopupOpen(prefs.displayMode === 'popup' || isStoredDrawerOpen);
bindPersistence(() => ({order: apps.map(app => app.id), isDrawerOpen: isTrayOpen(), quickSettings: quickSettingsSnapshot(), expanders: openExpanderIds()}));

document.addEventListener('click', event => {
    if (donateMenu.open && !donateMenu.contains(event.target))
        donateMenu.open = false;
});

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !donateMenu.open)
        return;
    donateMenu.open = false;
    donateMenu.querySelector('summary').focus();
});

setUpMiniTray();
restoreExpanders(storedExpanders);
bindExpanders();
bindMarkdownViews();
const compatButton = document.querySelector('[data-compat-open]');
compatButton.addEventListener('click', () => openCompatDialog(compatButton));
// The guide opens on the page, the link stays for a page without scripts
const guideLink = document.querySelector('[data-guide-open]');
guideLink.addEventListener('click', event => {
    event.preventDefault();
    openInstallGuide(guideLink);
});
bindQuickSettings(document.querySelector('#quick-settings'), systemIndicator, {bindClicks, openSettings});
bindOverlayScrollbars();
systemIndicator.addEventListener('click', toggleQuickSettings);
bindHoverSwitching(openActionMenu);

function onEscape(event) {
    if (event.key !== 'Escape')
        return;
    if (drag) {
        event.preventDefault();
        finishDrag(null, true);
        return;
    }
    const ownsEscape = document.querySelector('.bti-select-popover,.pref-color-overlay,#donate-menu[open]');
    if (ownsEscape)
        return;
    setPopupOpen(false);
    setQuickSettingsOpen(false);
}
