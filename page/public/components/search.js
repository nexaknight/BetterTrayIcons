import {_} from '../shared/i18n.js';
import {icon, iconButton} from './icon.js';
import {body} from './window.js';
import {badge} from './badge.js';
import {groupSection} from './group.js';
import {appBadges, apps} from '../shared/apps.js';
import {clamp, escapeHtml} from '../shared/util.js';
import {views} from '../shared/views.js';
import {buttonMarkup} from './button.js';

// Every app badge is a packaging flavor, which the real page draws as info
export const APP_BADGE_VARIANT = 'info';

export const filter = {tokens: [], query: ''};

// The search keeps its chips and text across list rebuilds, as the filter
// group above the list does in src/prefs/pages/applicationsPage.js
export function filterGroup() {
    const chips = filter.tokens.map(token =>
        badge(token, APP_BADGE_VARIANT, {className: 'pref-chip', suffix: iconButton('close', _('Remove'), `data-chip-remove="${escapeHtml(token)}"`)})
    ).join('');
    const search = `<div class="pref-token-search">${icon('search')}${chips}` +
        `<input id="pref-app-filter" placeholder="${_('Search apps')}" aria-label="${_('Search apps')}" autocomplete="off" value="${escapeHtml(filter.query)}"></div>`;
    return groupSection('', `${search}<div class="pref-suggestions" role="listbox" aria-label="Badges" hidden></div>`, '', 'pref-filter-group');
}

export function applyAppFilter() {
    const rows = [...body.querySelectorAll('[data-pref-app]')];
    let shownCount = 0;
    for (const appRowElement of rows) {
        const badges = appRowElement.dataset.badges.split('|');
        const hasTokens = filter.tokens.every(token => badges.includes(token));
        appRowElement.hidden = !hasTokens || !appRowElement.dataset.search.includes(filter.query);
        if (!appRowElement.hidden)
            shownCount++;
    }
    const hasNoMatch = rows.length > 0 && shownCount === 0;
    body.querySelector('.pref-no-match').hidden = !hasNoMatch;
    body.querySelector('.pref-apps-group').hidden = hasNoMatch;
    if (document.activeElement?.id === 'pref-app-filter')
        showSuggestions();
}

function showSuggestions() {
    const list = body.querySelector('.pref-suggestions');
    const options = filterOptions();
    list.innerHTML = options.map((option, i) =>
        buttonMarkup({leading: badge(option, APP_BADGE_VARIANT), label: option, attributes: `role="option" aria-selected="${i === 0 && filter.query !== ''}" data-suggestion="${escapeHtml(option)}"`})
    ).join('');
    list.hidden = options.length === 0;
}

function filterOptions() {
    const options = [...new Set(apps.flatMap(appBadges))].sort((a, b) => a.localeCompare(b));
    return options.filter(option => !filter.tokens.includes(option) && option.toLowerCase().includes(filter.query));
}

function hideSuggestions() {
    const list = body.querySelector('.pref-suggestions');
    if (list)
        list.hidden = true;
}

export function onFilterFocus(event) {
    if (event.target.id === 'pref-app-filter')
        showSuggestions();
    else if (!event.target.closest('.pref-filter-group'))
        hideSuggestions();
}

// The suggestions are a popover, a press anywhere else or a scroll of the
// page closes them as the real one closes on an outside press
export function onFilterPointer(event) {
    if (!event.target.closest('.pref-filter-group'))
        hideSuggestions();
}

export function onFilterScroll(event) {
    if (event.target.classList?.contains('pref-scroll'))
        hideSuggestions();
}

export function onFilterBlur(event) {
    if (!event.relatedTarget?.closest('.pref-filter-group'))
        hideSuggestions();
}

export function onFilterKey(event) {
    const list = body.querySelector('.pref-suggestions');
    const items = [...list.querySelectorAll('[role=option]')];
    const current = items.findIndex(item => item.getAttribute('aria-selected') === 'true');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = clamp(current + (event.key === 'ArrowDown' ? 1 : -1), -1, items.length - 1);
        items.forEach((item, i) => item.setAttribute('aria-selected', String(i === next)));
        return;
    }
    const canAddToken = !list.hidden && (current >= 0 || filter.query);
    if (event.key === 'Enter' && canAddToken) {
        event.preventDefault();
        addFilterToken((items[current] ?? items[0]).dataset.suggestion);
        return;
    }
    if (event.key === 'Escape') {
        list.hidden = true;
        return;
    }
    if (event.key === 'Backspace' && event.target.value === '' && filter.tokens.length)
        removeFilterToken(filter.tokens.at(-1));
}

export function addFilterToken(token) {
    filter.tokens.push(token);
    filter.query = '';
    rerenderFilter();
}

export function removeFilterToken(token) {
    filter.tokens = filter.tokens.filter(item => item !== token);
    rerenderFilter();
}

function rerenderFilter() {
    views.renderPage(true);
    body.querySelector('#pref-app-filter').focus({preventScroll: true});
}

export function clearFilter() {
    filter.tokens = [];
    filter.query = '';
}
