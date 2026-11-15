import {badge} from '../components/badge.js';
import {group} from '../components/group.js';
import {CHEVRON, icon} from '../components/icon.js';
import {row, rowIcon} from '../components/row.js';
import {APP_BADGE_VARIANT, filterGroup} from '../components/search.js';
import {appBadges, appIconMarkup, apps, displayName} from '../shared/apps.js';
import {_} from '../shared/i18n.js';
import {state} from '../shared/store.js';
import {escapeHtml} from '../shared/util.js';

export function applicationsPage() {
    const byName = (a, b) => displayName(a).localeCompare(displayName(b), undefined, {sensitivity: 'base'});
    const rows = [...apps].sort(byName).map(appRow).join('');
    const filterBar = state.showFilter ? filterGroup() : '';
    const noMatch = `<section class="pref-group pref-no-match" hidden><div class="pref-status-page">${icon('search')}<h2>${_('No Matching Apps')}</h2><p>${_('Try a different search term.')}</p></div></section>`;
    return filterBar + noMatch + group(_('Detected Apps'), rows, '', 'pref-apps-group');
}

// The badge line stays while empty, as createBadgeLine's does, so the rows
// keep one height with and without badges
function appRow(app) {
    const badges = appBadges(app);
    const badgeLine = state.showBadges ? `<span class="pref-row-badges">${badges.map(text => badge(text, APP_BADGE_VARIANT)).join('')}</span>` : '';
    const hiddenMark = state.appConfigs[app.id]?.hidden ? `<span class="pref-hidden-mark" data-pref-tooltip="${_('Hidden')}">${icon('hidden')}</span>` : '';
    const prefix = appRowIcon(app);
    const searchText = `${displayName(app)}\n${app.id}`.toLowerCase();
    const id = escapeHtml(app.id);
    return row(escapeHtml(displayName(app)), `${_('ID')}: ${id}`, hiddenMark + CHEVRON, prefix,
        `type="button" data-pref-app="${id}" data-badges="${escapeHtml(badges.join('|'))}" data-search="${escapeHtml(searchText)}"`, badgeLine);
}

// The list keeps every app the page has seen with its own icon, the switches
// only decide what the tray shows. An XEmbed app has no icon the page can
// read, so Proton's glyph stands in.
function appRowIcon(app) {
    if (app.isXembed)
        return rowIcon(icon('proton'));
    return rowIcon(appIconMarkup(app), {color: app.color});
}

