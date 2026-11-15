import {_} from '../shared/i18n.js';
import {iconButton} from './icon.js';
import {headerStart, main, overlay, root, sidebar, sidebarBrandEnd, sidebarButtons, sidebarShade} from './window.js';
import {ui} from '../shared/store.js';
import {views} from '../shared/views.js';

// PREFS_SIDEBAR_BREAKPOINT in src/prefs/components/sidebar.js
const SIDEBAR_BREAKPOINT_PX = 700;

// Browse selection, arrows move and select in one go like the GTK list
const SIDEBAR_KEY_STEPS = {
    ArrowDown: (index, count) => Math.min(index + 1, count - 1),
    ArrowUp: index => Math.max(index - 1, 0),
    Home: () => 0,
    End: (_index, count) => count - 1,
};

// Every surface that covers the root header gets a toggle of its own, and
// the toggles only show while the sidebar is collapsed
export function renderSidebarToggles() {
    const toggle = ui.isCollapsed ? sidebarToggle() : '';
    const back = ui.subpage ? iconButton('previous', _('Back'), 'data-native-back') : '';
    headerStart.innerHTML = toggle + back;
    sidebarBrandEnd.innerHTML = toggle;
}

function sidebarToggle() {
    const label = ui.isSidebarShown ? _('Hide Sidebar') : _('Show Sidebar');
    return iconButton(ui.isSidebarShown ? 'sidebar-hide' : 'sidebar-show', label,
        `data-sidebar-toggle aria-pressed="${ui.isSidebarShown}"`, 'flat');
}

export function setSidebarShown(isShown) {
    ui.isSidebarShown = isShown;
    root.classList.toggle('sidebar-shown', isShown);
    sidebarShade.hidden = !isShown;
    syncInert();
    renderSidebarToggles();
    if (isShown)
        sidebar.querySelector('[data-native-page].active').focus({preventScroll: true});
}

export function fitSidebar(windowWidth) {
    const isNarrow = windowWidth <= SIDEBAR_BREAKPOINT_PX;
    if (isNarrow === ui.isCollapsed)
        return;
    ui.isCollapsed = isNarrow;
    // Crossing the breakpoint swaps layouts at once, only a toggle slides
    root.classList.add('settling');
    root.classList.toggle('collapsed', isNarrow);
    setSidebarShown(false);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('settling')));
}

export function onSidebarKey(event) {
    const index = sidebarButtons.indexOf(event.target);
    const next = SIDEBAR_KEY_STEPS[event.key]?.(index, sidebarButtons.length);
    if (next === undefined)
        return;
    event.preventDefault();
    const key = sidebarButtons[next].dataset.nativePage;
    ui.subpage = null;
    ui.page = key;
    views.renderPage();
    sidebarButtons[next].focus({preventScroll: true});
}

// The overlay sidebar covers the content, a hidden one leaves the Tab chain
export function syncInert() {
    const isBlocked = ui.dialogType !== null || ui.picker !== null || ui.alert !== null;
    sidebar.inert = isBlocked || (ui.isCollapsed && !ui.isSidebarShown);
    main.inert = isBlocked || (ui.isCollapsed && ui.isSidebarShown);
    overlay.inert = ui.picker !== null || ui.alert !== null;
}
