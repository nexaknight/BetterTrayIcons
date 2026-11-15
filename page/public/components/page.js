import {_} from '../shared/i18n.js';
import {closeModal, openModal} from './modal.js';
import {iconButton} from './icon.js';
import {closeDropdown} from './popover.js';
import {applyAppFilter} from './search.js';
import {renderSidebarToggles, setSidebarShown} from './sidebar.js';
import {hidePrefTooltip} from './tooltip.js';
import {body, headerEnd, headerTitle, scroll, showWindow, sidebarButtons, translateBanner} from './window.js';
import {aboutPage} from '../pages/aboutPage.js';
import {actionsPage} from '../pages/actionPage.js';
import {appearancePage} from '../pages/appearancePage.js';
import {applicationsPage} from '../pages/applicationsPage.js';
import {generalPage} from '../pages/generalPage.js';
import {PAGE_KEYS} from '../shared/settings.js';
import {schedulePersist} from '../shared/persist.js';
import {state, ui} from '../shared/store.js';
import {overflowPage} from '../subpages/overflowMenuSubpage.js';
import {togglePage} from '../subpages/toggleButtonSubpage.js';
import {iconsPage} from '../subpages/trayIconsSubpage.js';

export const PAGES = {
    general: {title: _('General'), iconName: 'general', build: generalPage},
    appearance: {title: _('Appearance'), iconName: 'color', build: appearancePage},
    actions: {title: _('Actions'), iconName: 'actions', build: actionsPage},
    applications: {title: _('Applications'), iconName: 'apps', build: applicationsPage},
    about: {title: _('About'), iconName: 'about', build: aboutPage},
};

const SUBPAGES = {
    icons: {title: _('Tray Icons'), build: iconsPage},
    toggle: {title: _('Toggle Button'), build: togglePage},
    overflow: {title: _('Overflow Menu'), build: overflowPage},
};

export function openPage(key) {
    closeModal();
    showWindow();
    ui.subpage = null;
    ui.page = key === 'sync' ? 'general' : key;
    renderPage();
    if (key === 'sync')
        openModal('sync');
}

// Picking a row while collapsed also hides the overlay sidebar, as the
// row-activated handler in src/prefs/components/sidebar.js does
export function showPage(key) {
    ui.subpage = null;
    ui.page = key;
    closeModal();
    if (ui.isCollapsed)
        setSidebarShown(false);
    renderPage();
}

export function showSubpage(key) {
    ui.subpage = key;
    renderPage();
}

export function renderPage(shouldPreserveScroll = false) {
    schedulePersist();
    closeDropdown();
    hidePrefTooltip();
    const oldScroll = scroll.scrollTop;
    const current = ui.subpage ? SUBPAGES[ui.subpage] : PAGES[ui.page];
    translateBanner.hidden = ui.page !== 'about' || ui.subpage !== null;
    headerTitle.textContent = current.title;
    renderSidebarToggles();
    headerEnd.innerHTML = headerActions();
    for (const button of sidebarButtons) {
        const isActive = button.dataset.nativePage === ui.page;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-current', isActive ? 'page' : 'false');
        button.tabIndex = isActive ? 0 : -1;
    }
    body.innerHTML = current.build();
    if (ui.page === 'applications' && !ui.subpage)
        applyAppFilter();
    scroll.scrollTop = shouldPreserveScroll ? oldScroll : 0;
}

function headerActions() {
    const close = iconButton('close', _('Close'), 'data-native-close', 'close');
    if (ui.subpage || PAGE_KEYS[ui.page])
        return iconButton('reset', _('Reset'), 'data-native-reset="page"') + close;
    if (ui.page !== 'applications')
        return close;
    const badges = state.showBadges
        ? iconButton('tag-x', _('Hide Badges'), 'data-pref-switch="showBadges" aria-pressed="true"', 'active')
        : iconButton('tag', _('Show Badges'), 'data-pref-switch="showBadges" aria-pressed="false"');
    const filterLabel = state.showFilter ? _('Hide Search') : _('Search');
    const filterButton = iconButton('search', filterLabel, `data-pref-switch="showFilter" aria-pressed="${state.showFilter}"`, state.showFilter ? 'active' : '');
    const menu = iconButton('ellipsis-vertical', _('More Actions'), 'data-header-menu aria-haspopup="menu" aria-expanded="false"');
    return filterButton + badges + menu + close;
}
