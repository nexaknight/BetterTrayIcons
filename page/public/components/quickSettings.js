import {reducedMotion} from '../landing/elements.js';
import {renderApps} from '../landing/tray.js';
import {closeContextMenu, contextMenuAnchor, menuItemMarkup, openContextMenu} from './contextMenu.js';
import {flipTile, gridMarkup, setVolume, syncVolumeIcons, systemRow, toggleMute, volumeRow} from './qsGrid.js';
import {paintRange} from './range.js';
import {MEDIA_DIR, chooseRow, maskIcon, menuHeader, qsState, restoreQuickSettings} from './qsSections.js';
import {appById, appIconMarkup, apps, backgroundApp, colorIconMarkup, displayName, isAppHidden, isAppPresent, quitBackgroundApp} from '../shared/apps.js';
import {repoIconUrl} from '../shared/iconValues.js';
import {schedulePersist} from '../shared/persist.js';
import {state, storedQuickSettings} from '../shared/store.js';
import {clamp, escapeHtml} from '../shared/util.js';
import {_} from '../shared/i18n.js';
import {buttonMarkup} from './button.js';

const POPUP_GAP_PX = 6;
const POPUP_EDGE_PX = 8;
const BOTTOM_ROOM_PX = 56;
// A wheel step in lines, as Firefox reports it, scrolls by this much
const WHEEL_LINE_PX = 16;
// The quick settings menus slide open in about the shell's popup time
const SECTION_SLIDE_MS = 250;

let host = null;
let opener = null;
let bindRowClicks = null;
let openTraySettings = null;

// Collapsed on every open and after a mode switch, as GNOME's section opens
let isAppsExpanded = false;
let inlineMenu = null;
let renderedMode = null;

// In background-apps mode the tray items become the Background Apps rows,
// as src/shell/components/backgroundAppsHost.js does. Their actions close
// this menu through landing/panelMenus.js, so app.js hands the click
// binding and the settings opener in.
export function bindQuickSettings(element, systemIndicator, {bindClicks, openSettings}) {
    host = element;
    opener = systemIndicator;
    bindRowClicks = bindClicks;
    openTraySettings = openSettings;
    restoreQuickSettings(storedQuickSettings);
    // The panel's system indicator shows the restored level before any open
    syncVolumeIcons();
    host.addEventListener('input', onVolumeInput);
    host.addEventListener('click', onHostClick);
    host.addEventListener('keydown', onHostKey);
    host.addEventListener('wheel', onHostWheel, {passive: false});
    document.addEventListener('pointerdown', onOutsidePress, true);
}

export function isQuickSettingsOpen() {
    return Boolean(host) && !host.hidden;
}

export function setQuickSettingsOpen(isOpen) {
    if (!host || isOpen === !host.hidden)
        return;
    host.hidden = !isOpen;
    opener.setAttribute('aria-expanded', String(isOpen));
    closeRowMenus();
    if (!isOpen)
        return;
    isAppsExpanded = false;
    renderQuickSettings();
    host.querySelector('button').focus({preventScroll: true});
}

function closeRowMenus() {
    inlineMenu = null;
    if (host.contains(contextMenuAnchor()))
        closeContextMenu();
}

export function renderQuickSettings() {
    if (!host || host.hidden)
        return;
    if (renderedMode !== state.displayMode)
        isAppsExpanded = false;
    renderedMode = state.displayMode;
    if (state.qsMenuStyle !== 'inline' || !isAppsExpanded)
        inlineMenu = null;
    // A side popup hangs on a row the render is about to replace
    if (host.contains(contextMenuAnchor()))
        closeContextMenu();
    const tiles = gridMarkup();
    host.innerHTML = `${systemRow()}${volumeRow()}<div class="qs-grid">${tiles}</div>${backgroundAppsSection()}`;
    for (const row of host.querySelectorAll('[data-qs-app]')) {
        const app = appById(row.dataset.qsApp);
        bindRowClicks(row, {prefix: 'tray', app, afterAction: afterRowAction, openMenu: items => openRowMenu(row, items)});
    }
    placeQuickSettings();
}

// In background-apps mode Pika takes a tray row like every tray app, so the
// page sets what the extension makes of it against GNOME's stock row
function backgroundAppsSection() {
    const isTrayMode = state.displayMode === 'background-apps';
    const stockApp = backgroundApp();
    const hasStockRow = Boolean(stockApp) && !isTrayMode && !state.hideBackground;
    const trayApps = isTrayMode ? apps.filter(app => (app === stockApp || isAppPresent(app)) && !isAppHidden(app)) : [];
    const count = trayApps.length + Number(hasStockRow);
    if (count === 0)
        return '';
    const title = count === 1 ? _('1 Background App') : _('%1 Background Apps').replace('%1', String(count));
    const expander = buttonMarkup({variant: 'qs-apps-toggle', title: `<span>${title}</span>`, trailing: maskIcon(repoIconUrl('next')), attributes: `aria-expanded="${isAppsExpanded}" data-qs-expand`});
    if (!isAppsExpanded)
        return `<div class="qs-apps">${expander}</div>`;
    const rows = trayApps.map(trayRow).join('') + (hasStockRow ? stockRow(stockApp) : '');
    const btiSettings = isTrayMode ? buttonMarkup({variant: 'qs-menu-item', title: _('Open BTI Settings'), attributes: 'data-qs-bti-settings'}) : '';
    return `<div class="qs-apps">${expander}<div class="qs-apps-menu">` +
        `${menuHeader(`${MEDIA_DIR}/lucide-ghost.svg`, _('Background Apps'))}` +
        `<div class="qs-apps-list">${rows}</div>` +
        `<div class="qs-separator"></div>${buttonMarkup({variant: 'qs-menu-item', title: _('App Settings'), attributes: 'data-qs-close'})}${btiSettings}</div></div>`;
}

function trayRow(app) {
    const isMenuOpen = inlineMenu?.appId === app.id;
    const row = buttonMarkup({
        variant: `qs-app-row ${isMenuOpen ? 'menu-open' : ''}`,
        leading: `<span class="qs-app-icon" style="color:${app.color}">${appIconMarkup(app, 'aria-hidden="true"')}</span>`,
        title: escapeHtml(displayName(app)),
        subtitle: app.message ? escapeHtml(app.message) : '',
        textClass: 'qs-app-text',
        label: displayName(app),
        attributes: `data-qs-app="${app.id}" aria-expanded="${isMenuOpen}"`,
    });
    const menu = isMenuOpen ? `<div class="qs-inline-menu" role="menu">${inlineMenu.items.map(menuItemMarkup).join('')}</div>` : '';
    return `${row}${menu}`;
}

// A stock row has no menu, only the button that quits the app
function stockRow(app) {
    const text = `<span class="qs-app-text"><span>${escapeHtml(app.name)}</span><small>${escapeHtml(app.message)}</small></span>`;
    return `<div class="qs-app-row stock"><span class="qs-app-icon">${colorIconMarkup(app.icon, 'aria-hidden="true"')}</span>${text}` +
        `${buttonMarkup({variant: 'qs-quit', leading: maskIcon(repoIconUrl('close')), label: _('Quit %1').replace('%1', app.name), attributes: 'data-qs-quit'})}</div>`;
}

// keep-popup-after-click governs Quick Settings too. A menu stays anchored
// to its row, so the menu itself does not close anything.
function afterRowAction(action) {
    const didNothing = action === 'None' || action === undefined;
    if (!didNothing && action !== 'Open Menu' && !state.keepOpen)
        setQuickSettingsOpen(false);
}

// qs-menu-style picks the side popup beside Quick Settings or the menu that
// unfolds below its row, as backgroundAppsHost.js does
function openRowMenu(row, items) {
    if (state.qsMenuStyle !== 'inline') {
        openContextMenu(row, items, {beside: host});
        return;
    }
    const appId = row.dataset.qsApp;
    inlineMenu = inlineMenu?.appId === appId ? null : {appId, items};
    renderQuickSettings();
    host.querySelector(inlineMenu ? '.qs-inline-menu button:not(:disabled)' : `[data-qs-app="${appId}"]`)?.focus({preventScroll: true});
}

function placeQuickSettings() {
    const desktop = host.parentElement;
    const bounds = desktop.getBoundingClientRect();
    const button = opener.getBoundingClientRect();
    const panel = desktop.querySelector('.panel');
    const right = button.right - bounds.left;
    host.style.top = `${panel.offsetTop + panel.offsetHeight + POPUP_GAP_PX}px`;
    host.style.left = `${clamp(right - host.offsetWidth, POPUP_EDGE_PX, bounds.width - host.offsetWidth - POPUP_EDGE_PX)}px`;
    capAppsList(bounds.height - BOTTOM_ROOM_PX);
}

// Quick Settings never scrolls, so the list stops at the row limit or at
// what the desktop leaves next to everything else Quick Settings shows,
// whichever is smaller. An open inline menu adds its height to the limit, as
// _syncScrollCap in src/shell/components/backgroundAppsHost.js does. When
// the room runs out the rows give way first, the menu only scrolls once it
// alone outgrows the room below its row.
function capAppsList(maxHeight) {
    const list = host.querySelector('.qs-apps-list');
    if (!list)
        return;
    const room = Math.max(0, maxHeight - (host.offsetHeight - list.offsetHeight));
    const menu = list.querySelector('.qs-inline-menu');
    const menuHeight = menu?.scrollHeight ?? 0;
    const viewHeight = Math.min(rowCapHeight(list) + menuHeight, room);
    list.style.maxHeight = `${viewHeight}px`;
    if (!menu)
        return;
    const row = menu.previousElementSibling;
    menu.style.maxHeight = `${Math.max(0, viewHeight - row.offsetHeight)}px`;
    reveal(list, row, menu);
}

// Real row heights, so the list ends on a row's edge whatever the rows hold
function rowCapHeight(list) {
    const rows = [...list.querySelectorAll('.qs-app-row')];
    const cap = clamp(state.qsVisibleRows, 1, rows.length);
    if (rows.length <= cap)
        return Infinity;
    return rows.slice(0, cap).reduce((sum, row) => sum + row.offsetHeight, 0);
}

function reveal(view, row, menu) {
    const viewTop = view.getBoundingClientRect().top + view.clientTop;
    const top = row.getBoundingClientRect().top - viewTop;
    const bottom = menu.getBoundingClientRect().bottom - viewTop;
    if (bottom > view.clientHeight)
        view.scrollTop += bottom - view.clientHeight;
    else if (top < 0)
        view.scrollTop += top;
}

// Over an inline menu the wheel goes to the menu until it hits the end it
// moves toward, then on to the list in the same gesture. The browser alone
// would stop at the menu's end, overscroll-behavior holds it there.
function onHostWheel(event) {
    const menu = event.target.closest('.qs-inline-menu');
    if (!menu)
        return;
    event.preventDefault();
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * WHEEL_LINE_PX : event.deltaY;
    const view = canScroll(menu, delta) ? menu : menu.parentElement;
    view.scrollTop += delta;
}

function canScroll(view, delta) {
    if (delta < 0)
        return view.scrollTop > 0;
    return Math.ceil(view.scrollTop + view.clientHeight) < view.scrollHeight;
}

// Names and hidden flags from the app dialog show on the tray and in Quick Settings
export function refreshApps() {
    renderApps();
    renderQuickSettings();
}

export function quickSettingsSnapshot() {
    return structuredClone(qsState);
}

function onVolumeInput(event) {
    if (!event.target.matches('[data-qs-volume]'))
        return;
    setVolume(Number(event.target.value));
    showVolume(event.target);
}

function showVolume(slider) {
    paintRange(slider);
    host.querySelector('[data-qs-mute]').setAttribute('aria-pressed', String(qsState.isMuted));
    syncVolumeIcons();
    schedulePersist();
}

function onHostClick(event) {
    const arrow = event.target.closest('[data-qs-arrow]');
    if (arrow) {
        toggleSection(arrow.dataset.qsArrow);
        return;
    }
    const choice = event.target.closest('[data-qs-choose]');
    if (choice) {
        chooseRow(choice.dataset.qsChoose, choice.dataset.value);
        schedulePersist();
        renderQuickSettings();
        host.querySelector(`[data-qs-choose][data-value="${CSS.escape(choice.dataset.value)}"]`).focus({preventScroll: true});
        return;
    }
    const menuItem = event.target.closest('[data-menu-index]');
    if (menuItem && inlineMenu) {
        const item = inlineMenu.items[menuItem.dataset.menuIndex];
        inlineMenu = null;
        renderQuickSettings();
        item.onActivate();
        return;
    }
    if (event.target.closest('[data-qs-mute]')) {
        toggleMute();
        const slider = host.querySelector('[data-qs-volume]');
        slider.value = String(qsState.volume);
        showVolume(slider);
        return;
    }
    const tile = event.target.closest('[data-qs-tile]');
    if (tile) {
        toggleTile(tile);
        return;
    }
    if (event.target.closest('[data-qs-expand]')) {
        isAppsExpanded = !isAppsExpanded;
        renderQuickSettings();
        host.querySelector('[data-qs-expand]').focus({preventScroll: true});
        return;
    }
    if (event.target.closest('[data-qs-quit]')) {
        quitBackgroundApp();
        refreshApps();
        host.querySelector('button').focus({preventScroll: true});
        return;
    }
    if (event.target.closest('[data-qs-bti-settings]')) {
        setQuickSettingsOpen(false);
        openTraySettings();
        return;
    }
    if (event.target.closest('[data-qs-close]'))
        setQuickSettingsOpen(false);
}

// One menu at a time, a second tap on the open arrow folds it away
function toggleSection(id) {
    const previous = host.querySelector('.qs-section');
    if (qsState.openSection === id) {
        qsState.openSection = null;
        foldAway(previous);
    } else {
        qsState.openSection = id;
        renderQuickSettings();
        unfold(host.querySelector('.qs-section'));
    }
    schedulePersist();
}

function unfold(section) {
    if (reducedMotion.matches)
        return;
    const height = `${section.offsetHeight}px`;
    section.animate([{height: '0px', opacity: 0}, {height, opacity: 1}], {duration: SECTION_SLIDE_MS, easing: 'ease-out'});
}

function foldAway(section) {
    host.querySelector('[aria-expanded="true"][data-qs-arrow]').setAttribute('aria-expanded', 'false');
    if (reducedMotion.matches) {
        renderQuickSettings();
        return;
    }
    const slide = section.animate([{height: `${section.offsetHeight}px`, opacity: 1}, {height: '0px', opacity: 0}], {duration: SECTION_SLIDE_MS, easing: 'ease-in', fill: 'forwards'});
    slide.onfinish = () => renderQuickSettings();
}

function toggleTile(button) {
    const id = button.dataset.qsTile;
    flipTile(id);
    schedulePersist();
    renderQuickSettings();
    host.querySelector(`[data-qs-tile="${id}"]`).focus({preventScroll: true});
}

function onHostKey(event) {
    if (event.key !== 'Escape')
        return;
    event.preventDefault();
    event.stopPropagation();
    if (inlineMenu) {
        const {appId} = inlineMenu;
        inlineMenu = null;
        renderQuickSettings();
        host.querySelector(`[data-qs-app="${appId}"]`).focus({preventScroll: true});
        return;
    }
    setQuickSettingsOpen(false);
    opener.focus({preventScroll: true});
}

function onOutsidePress(event) {
    if (host.hidden)
        return;
    const isInside = host.contains(event.target) || opener.contains(event.target) ||
        event.target.closest('.shell-menu,.app-window-host');
    if (!isInside)
        setQuickSettingsOpen(false);
}
