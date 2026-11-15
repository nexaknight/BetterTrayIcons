import {badge} from '../components/badge.js';
import {smallButton} from '../components/button.js';
import {group, groupSection} from '../components/group.js';
import {icon} from '../components/icon.js';
import {openPageDialog} from '../components/pageDialog.js';
import {bindSelect} from '../components/popover.js';
import {row, selectRow} from '../components/row.js';
import {escapeHtml, fetchJson} from '../shared/util.js';
import {_} from '../shared/i18n.js';

// extras.sh writes compat.json from the release tags
const COMPAT_URL = 'compat.json';
const RELEASE_URL = 'https://github.com/nexaknight/BetterTrayIcons/releases/tag/v';
const PAGE_SIZE = 4;
const SELECT_KEY = 'compatGnome';
const RELEASE_DATE = new Intl.DateTimeFormat(navigator.language, {dateStyle: 'medium', timeZone: 'UTC'});

let compat = null;
let current = null;

// A browser can't read the GNOME Shell version, the user agent only says
// Linux, so the dialog lets people pick theirs
export function openCompatDialog(opener) {
    current?.dialog.close();
    const dialog = openPageDialog({title: _('Check Compatibility'), className: 'compat-dialog', opener, onClose: () => (current = null)});
    current = {dialog, host: dialog.host, gnome: '', shown: PAGE_SIZE, hasLoadFailed: false};
    dialog.host.addEventListener('click', onHostClick);
    renderCompatDialog();
    loadCompat();
}

bindSelect(SELECT_KEY, {
    getValue: () => current.gnome,
    choose: gnome => {
        current.gnome = gnome;
        current.shown = PAGE_SIZE;
        renderCompatDialog();
        current.host.querySelector(`[data-pref-select-trigger="${SELECT_KEY}"]`).focus({preventScroll: true});
    },
});

async function loadCompat() {
    let isLoaded = true;
    try {
        compat ??= await fetchJson(COMPAT_URL);
    } catch {
        isLoaded = false;
    }
    if (!current)
        return;
    if (!isLoaded) {
        current.hasLoadFailed = true;
        renderCompatDialog();
        return;
    }
    // The newest GNOME the current build supports, as metadata.json lists it
    current.gnome = compat.current.shell.at(-1);
    renderCompatDialog();
    current.host.querySelector('button').focus({preventScroll: true});
}

function renderCompatDialog() {
    current.dialog.setBody(dialogBody());
}

function dialogBody() {
    if (current.hasLoadFailed)
        return `<p class="compat-note">${_('Could not load the release list, try again later.')}</p>`;
    if (!current.gnome)
        return `<p class="compat-note">${_('Loading releases…')}</p>`;
    const versions = Object.keys(compat.gnome);
    const picker = selectRow('GNOME Shell', SELECT_KEY, versions, _('Pick the version your desktop runs.'), {selected: current.gnome});
    const releases = compat.gnome[current.gnome];
    const items = releases.slice(0, current.shown).map(releaseItem).join('');
    const more = releases.length > current.shown
        ? smallButton(_('Load More'), 'data-compat-more', 'pref-load-more')
        : '';
    const releaseList = groupSection(escapeHtml(_('Releases for GNOME %1').replace('%1', current.gnome)), `<ul class="compat-releases pref-scroll-list">${items}</ul>${more}`);
    return group('', picker + latestReleaseRow()) + supportStatus(releases) + releaseList;
}

// compat.current is the build metadata.json describes, its tag may not exist yet
function latestReleaseRow() {
    const {version} = compat.current;
    const release = Object.values(compat.gnome).flat().find(entry => entry.version === version) ?? {version, unreleased: true};
    const date = release.date ? RELEASE_DATE.format(new Date(release.date)) : '';
    return row(_('Latest release'), escapeHtml(date), latestReleaseLabel(release));
}

// A badge so the version ends flush with the GNOME Shell select above it
function latestReleaseLabel({version, unreleased}) {
    const versionBadge = badge(`v${version}`, 'info');
    if (unreleased)
        return `<span>${_('unreleased')}</span> ${versionBadge}`;
    return releaseLink(version, versionBadge);
}

function supportStatus(releases) {
    const isSupported = compat.current.shell.includes(current.gnome);
    const text = isSupported
        ? _('Your GNOME version is supported by the latest release.')
        : _('The latest release no longer supports this GNOME version. The last release that did is %1.').replace('%1', `v${releases[0].version}`);
    return `<p class="compat-status ${isSupported ? 'supported' : 'unsupported'}">${icon(isSupported ? 'select' : 'warning')}<span>${escapeHtml(text)}</span></p>`;
}

function releaseItem(release) {
    const hasDate = release.date && !release.unreleased;
    const when = hasDate ? ` <span>${RELEASE_DATE.format(new Date(release.date))}</span>` : '';
    return `<li>${releaseLabel(release)}${when}</li>`;
}

function releaseLabel({version, unreleased}) {
    const name = escapeHtml(`v${version}`);
    if (unreleased)
        return `<strong>${name}</strong> <span>${_('unreleased')}</span>`;
    return releaseLink(version, name);
}

function releaseLink(version, content) {
    return `<a href="${RELEASE_URL}${encodeURIComponent(version)}" target="_blank" rel="noopener">${content}</a>`;
}

function onHostClick(event) {
    if (!current || !event.target.closest('[data-compat-more]'))
        return;
    const firstNew = current.shown;
    current.shown += PAGE_SIZE;
    renderCompatDialog();
    // The list scrolls inside its own box, so the new rows come into view there
    current.host.querySelectorAll('.compat-releases li')[firstNew].scrollIntoView({block: 'nearest'});
    const focusTarget = current.host.querySelector('[data-compat-more]') ?? current.host.querySelector('.compat-releases li:last-child a');
    focusTarget.focus({preventScroll: true});
}
