import {CUSTOM_SAMPLE_PATH, EMOJI_PREFIX, LUCIDE_PREFIX, emojiText, isEmojiValue} from '../shared/iconValues.js';
import {ui} from '../shared/store.js';
import {fetchJson} from '../shared/util.js';
import {views} from '../shared/views.js';

// extras.sh copies the extension's catalog, the same file
// src/prefs/components/emoji.js reads
const EMOJI_CATALOG_URL = 'assets/emoji/emoji.json';

let catalog = null;
let catalogPromise = null;

export function loadEmojiCatalog() {
    catalogPromise ??= fetchJson(EMOJI_CATALOG_URL).then(data => {
        catalog = data.emoji.map(([hex, name, group, keywords]) => ({
            value: `${EMOJI_PREFIX}${hex}`,
            text: emojiText(`${EMOJI_PREFIX}${hex}`),
            name,
            group,
            search: ` ${name} ${keywords}`.toLowerCase(),
        }));
        return catalog;
    });
    catalogPromise.catch(() => (catalogPromise = null));
    return catalogPromise;
}

// setIconSubtitle in src/prefs/components/emoji.js. The config keeps the
// codepoints, a row shows the emoji's name. The glyph stands in until the
// catalog answers, then the page renders again.
export function iconSubtitle(value, fallback = '') {
    if (value === CUSTOM_SAMPLE_PATH)
        return value;
    // A pack icon reads "firefox (MacTahoe)", Lucide is the demo's only pack
    if (value?.startsWith(LUCIDE_PREFIX))
        return `${value.slice(LUCIDE_PREFIX.length)} (Lucide)`;
    if (!isEmojiValue(value))
        return value || fallback;
    const name = catalog?.find(emoji => emoji.value === value)?.name;
    if (name)
        return name[0].toUpperCase() + name.slice(1);
    loadEmojiCatalog().then(() => {
        // A render would close an open picker, its own pick renders anyway
        if (ui.dropdownPopover)
            return;
        views.renderPage(true);
        if (ui.dialogType)
            views.renderModal();
    }).catch(() => {});
    return emojiText(value) ?? value;
}
