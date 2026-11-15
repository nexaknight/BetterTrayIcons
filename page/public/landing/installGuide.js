import {createMarkdownView} from '../components/markdown.js';
import {openPageDialog} from '../components/pageDialog.js';
import {_} from '../shared/i18n.js';

// The wiki's Installation page, read raw and drawn with the extension's own
// markdown viewer so the guide opens on the page
const GUIDE_URL = 'https://raw.githubusercontent.com/wiki/nexaknight/BetterTrayIcons/Installation.md';
const WIKI_PAGE_URL = 'https://github.com/nexaknight/BetterTrayIcons/wiki/Installation';
// The viewer only links absolute URLs, a wiki link names a sibling page and
// a ../../ link climbs from the page to the repository
const RELATIVE_LINK = /\]\((?![a-z]+:|#)([^)\s]+)\)/gi;

let guide = null;

export async function openInstallGuide(opener) {
    const dialog = openPageDialog({title: _('Installation Guide'), className: 'guide-dialog', opener});
    dialog.setBody(`<p class="compat-note">${_('Loading the guide…')}</p>`);
    try {
        guide ??= await readGuide();
    } catch {
        dialog.setBody(`<p class="compat-note">${_('Could not load the guide.')} ` +
            `<a href="${WIKI_PAGE_URL}" target="_blank" rel="noopener">${_('Open it on GitHub')}</a></p>`);
        return;
    }
    dialog.setBody(createMarkdownView(guide));
}

async function readGuide() {
    const response = await fetch(GUIDE_URL);
    if (!response.ok)
        throw new Error(String(response.status));
    const text = await response.text();
    return text.replace(RELATIVE_LINK, (_match, link) => `](${absoluteLink(link)})`);
}

function absoluteLink(link) {
    const base = link.startsWith('../') ? `${WIKI_PAGE_URL}/` : WIKI_PAGE_URL;
    return new URL(link, base).href;
}
