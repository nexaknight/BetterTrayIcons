import {smallButton} from '../components/button.js';
import {group} from '../components/group.js';
import {icon} from '../components/icon.js';
import {createBlocksView, createMarkdownView} from '../components/markdown.js';
import {loadingRow, row, segmentGroup} from '../components/row.js';
import {overlay} from '../components/window.js';
import {API_REPO_URL} from '../pages/aboutPage.js';
import {DBUS_SPECS, inspirationLinks} from '../../../src/shared/credits.js';
import {parseReleaseNotes} from '../../../src/shared/releaseNotes.js';
import {_} from '../shared/i18n.js';
import {state, ui} from '../shared/store.js';
import {escapeHtml, fetchJson} from '../shared/util.js';
import {views} from '../shared/views.js';

const CHANGELOG_PAGE_SIZE = 5;
const CREDITS_DIALOG_WIDTH_PX = 600;
const LINK_DIALOG_WIDTH_PX = 500;
const CREDIT_FILES = [[_('Icons'), 'assets/icons/CREDITS.md'], [_('Emojis'), 'assets/emoji/CREDITS.md']];

const INSPIRATION_LINKS = inspirationLinks(_);

let changelog = null;

export function openChangelog() {
    changelog = {releases: [], page: 0, hasMore: false, error: '', isLoading: true};
    views.openModal('changelog');
    loadOlderReleases();
}

export async function loadOlderReleases() {
    changelog.isLoading = true;
    changelog.page++;
    renderModalIf('changelog');
    try {
        const releases = await fetchJson(`${API_REPO_URL}/releases?per_page=${CHANGELOG_PAGE_SIZE}&page=${changelog.page}`);
        changelog.releases.push(...releases);
        changelog.hasMore = releases.length === CHANGELOG_PAGE_SIZE;
    } catch (error) {
        changelog.error = error.message;
    }
    changelog.isLoading = false;
    renderModalIf('changelog');
}

// A fetch can land after the dialog closed or another one opened
function renderModalIf(kind) {
    if (ui.dialogType === kind)
        views.renderModal();
}

export function changelogContent() {
    if (changelog.error)
        return `<p class="pref-text-dialog">${escapeHtml(_('Failed to load changelog: ') + changelog.error)}</p>`;
    if (changelog.isLoading && !changelog.releases.length)
        return loadingRow();
    if (!changelog.releases.length)
        return `<p class="pref-text-dialog">${_('No releases found.')}</p>`;
    // _appendRelease in src/prefs/pages/aboutPage.js
    const releases = changelog.releases.map(release =>
        createBlocksView(parseReleaseNotes(release.body), `<b class="pref-md-x-large">${escapeHtml(release.name || release.tag_name)}</b>`)
    ).join('<hr class="pref-md-release-rule">');
    const more = changelog.hasMore ? smallButton(_('Load older releases'), `data-changelog-more ${changelog.isLoading ? 'disabled' : ''}`, 'pref-load-more') : '';
    return `<div class="pref-changelog">${releases}${more}</div>`;
}

export async function openCredits() {
    const texts = await Promise.all(CREDIT_FILES.map(async ([, path]) => {
        const response = await fetch(path);
        return response.ok ? response.text() : '';
    }));
    state.creditTexts = texts;
    state.creditTab = 0;
    views.openModal('credits');
}

export function creditsDialog() {
    const tabs = segmentGroup(_('Icons and Emojis'), 'creditTab', CREDIT_FILES.map(([label], i) => [i, label]),
        {className: 'pref-dialog-tabs', buttonAttributes: i => `data-dialog-tab="${i}"`});
    const content = createMarkdownView(state.creditTexts[state.creditTab]);
    return {title: _('Icons and Emojis'), width: CREDITS_DIALOG_WIDTH_PX, content, titleWidget: tabs};
}

export function showDialogTab(index) {
    state.creditTab = Number(index);
    views.renderModal();
    overlay.querySelector(`[data-dialog-tab="${index}"]`).focus({preventScroll: true});
}

export function linkDialog(kind) {
    const isDbus = kind === 'dbus';
    const links = isDbus ? DBUS_SPECS : INSPIRATION_LINKS;
    const description = isDbus ? _('The specifications behind the interface files BTI implements.') : _('Projects BTI learned from.');
    const rows = links.map(({name, url, about}) => {
        const prefix = icon(url.includes('github.com') ? 'github' : 'link');
        // A URL breaks after its slashes first, where Pango's WORD_CHAR does
        const subtitle = about ? escapeHtml(about).replaceAll('\n', '<br>') : escapeHtml(url).replaceAll('/', '/<wbr>');
        return row(escapeHtml(name), subtitle, icon('link'), prefix, `type="button" data-native-link="${url}"`);
    }).join('');
    return {title: isDbus ? _('D-Bus Interfaces') : _('Inspiration'), width: LINK_DIALOG_WIDTH_PX, content: group('', rows, description)};
}
