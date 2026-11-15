import {smallButton} from '../components/button.js';
import {group, groupSection, rowList} from '../components/group.js';
import {icon} from '../components/icon.js';
import {expanderRow} from '../components/expander.js';
import {loadingRow, row} from '../components/row.js';
import {_} from '../shared/i18n.js';
import {escapeHtml, fetchJson} from '../shared/util.js';
import {views} from '../shared/views.js';

const VERSION = document.querySelector('meta[name="bti-version"]').content;
const AVATAR_VARIANTS = 4;
const REPO_URL = 'https://github.com/nexaknight/BetterTrayIcons';
export const API_REPO_URL = 'https://api.github.com/repos/nexaknight/BetterTrayIcons';
const CONTRIBUTORS_URL = `${API_REPO_URL}/contributors`;
const MAX_CONTRIBUTORS = 5;

const DONATIONS = [
    {name: 'GitHub', url: 'https://github.com/sponsors/nexaknight', iconName: 'github'},
    {name: 'Buy Me a Coffee', url: 'https://www.buymeacoffee.com/nexaknight', iconName: 'buymeacoffee'},
];

// Mirrors CONTRIBUTORS_OPTOUT in src/const.js
const CONTRIBUTORS_OPTOUT = new Set(['github-actions[bot]', 'dependabot[bot]', 'agent19872']);

let contributors = null;

export function aboutPage() {
    const linkIcon = icon('link', 'pref-about-inline-icon');
    const donations = DONATIONS.map(({name, url, iconName}) =>
        row(name, url, linkIcon, icon(iconName), `type="button" data-native-link="${url}"`)
    ).join('');
    const information = row(_('Version'), '', escapeHtml(VERSION), icon('tag')) +
        row(_('Source Code'), '', `${icon('github', 'pref-about-inline-icon')}GitHub`, icon('code'), `type="button" data-native-link="${REPO_URL}"`) +
        row(_('Changelog'), _('Recent releases'), '', icon('changelog'), 'type="button" data-changelog') +
        expanderRow('sponsor', _('Sponsor'), _('Support development.'), {prefix: icon('heart'), rows: donations});
    const credits = row(_('Icons and Emojis'), '', '', icon('grid'), 'type="button" data-credits') +
        row(_('D-Bus Interfaces'), '', '', icon('code'), 'type="button" data-link-dialog="dbus"') +
        row(_('Inspiration'), '', '', icon('users'), 'type="button" data-link-dialog="inspiration"');
    const legalRows = expanderRow('credits', _('Credits'), '', {prefix: icon('star'), rows: credits}) +
        row(_('License'), '', '', icon('license'), `type="button" data-native-link="${REPO_URL}/blob/main/LICENSE"`);
    const disclaimer = escapeHtml(_('Provided "as is", without warranty. The authors are not liable for damages.'));
    const footer = `<div class="pref-about-footer"><p>${_('Powered by')}</p><img src="assets/logo.svg" alt="NexaKnight"></div>`;
    const legal = groupSection(_('Legal'), `${rowList(legalRows)}<p class="pref-legal-note">${disclaimer}</p>${footer}`);
    return group(_('Information'), information) + contributorsGroup() + legal;
}

function contributorsGroup() {
    if (contributors === null) {
        const load = smallButton(_('Load'), 'data-load-contributors', 'suggested');
        return group(_('Contributors'), row(_('Loaded from GitHub'), _('Contacts api.github.com on demand.'), load, icon('users')));
    }
    if (contributors === 'loading')
        return group(_('Contributors'), loadingRow());
    if (contributors === 'failed')
        return contributorsSection(`<p class="pref-description">${_('Could not reach GitHub, try again later.')}</p>`, contributorCard('nexaknight', '', _('Maintainer'), 0));
    if (!contributors.length)
        return groupSection(_('Contributors'), `<p class="pref-empty-note">${_('No contributors found')}</p>`);
    const cards = contributors.slice(0, MAX_CONTRIBUTORS).map((contributor, index) =>
        contributorCard(contributor.login, contributor.avatar_url, `${contributor.contributions} ${_('commits')}`, index)
    ).join('');
    const more = contributors.length > MAX_CONTRIBUTORS
        ? `<a class="pref-contributor" href="${REPO_URL}/graphs/contributors" target="_blank" rel="noopener" data-pref-tooltip="${_('Open on GitHub')}">${icon('other', 'pref-more-icon')}<strong>${_('Show more')}</strong></a>`
        : '';
    return contributorsSection('', cards + more);
}

function contributorsSection(note, cards) {
    return groupSection(_('Contributors'), `${note}<div class="pref-contributors">${cards}</div>`);
}

function contributorCard(login, avatarUrl, note, index) {
    const name = escapeHtml(login);
    const initial = escapeHtml(login.charAt(0).toUpperCase());
    const avatar = avatarUrl
        ? `<img class="pref-avatar-photo" src="${escapeHtml(avatarUrl)}" alt="${name}" data-initial="${initial}" onerror="this.replaceWith(this.dataset.initial)">`
        : initial;
    return `<a class="pref-contributor" href="https://github.com/${encodeURIComponent(login)}" target="_blank" rel="noopener" data-pref-tooltip="${name}">` +
        `<span class="pref-avatar avatar-${index % AVATAR_VARIANTS}">${avatar}</span><strong>${name}</strong><small>${note}</small></a>`;
}

export async function loadContributors() {
    contributors = 'loading';
    views.renderPage(true);
    try {
        contributors = await fetchContributors();
    } catch {
        contributors = 'failed';
    }
    views.renderPage(true);
}

async function fetchContributors() {
    const list = await fetchJson(CONTRIBUTORS_URL);
    return (Array.isArray(list) ? list : [])
        .filter(contributor => contributor && typeof contributor.login === 'string' && !CONTRIBUTORS_OPTOUT.has(contributor.login.toLowerCase()))
        .sort((a, b) => b.contributions - a.contributions);
}
