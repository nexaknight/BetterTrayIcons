import {escapeHtml} from './util.js';

// One icon value is a repo icon name, an emoji:<hex> codepoint string as in
// src/shared/iconLoading.js, a Lucide name loaded from the CDN, or the custom
// sample path that stands in for a picked file
export const EMOJI_PREFIX = 'emoji:';
export const LUCIDE_PREFIX = 'lucide:';
const LUCIDE_VERSION = '1.66.0';
export const LUCIDE_URL = `https://cdn.jsdelivr.net/npm/lucide-static@${LUCIDE_VERSION}`;
export const CUSTOM_SAMPLE_PATH = '/home/you/Pictures/rocket.svg';
const CUSTOM_SAMPLE_ICON = 'rocket';
const REPO_ICON_DIR = 'assets/icons/hicolor/scalable/actions';
// EMOJI_GLYPH_ICON_RATIO in src/shell/icons/iconContent.js, the glyph keeps a padding ring
const EMOJI_GLYPH_RATIO = 0.83;
const EMOJI_VALUE = /^emoji:([0-9a-f]{1,6}(?:-[0-9a-f]{1,6}){0,9})$/;

export function isEmojiValue(value) {
    return EMOJI_VALUE.test(value ?? '');
}

export function emojiText(value) {
    const match = value.match(EMOJI_VALUE);
    return match ? String.fromCodePoint(...match[1].split('-').map(hex => parseInt(hex, 16))) : null;
}

export function repoIconUrl(name) {
    return `${REPO_ICON_DIR}/bti-${name}-symbolic.svg`;
}

// The mask image behind a symbolic value, null for an emoji
export function iconUrl(value) {
    if (value === CUSTOM_SAMPLE_PATH)
        return lucideUrl(CUSTOM_SAMPLE_ICON);
    if (value.startsWith(LUCIDE_PREFIX))
        return lucideUrl(value.slice(LUCIDE_PREFIX.length));
    if (value.startsWith('bti-'))
        return `${REPO_ICON_DIR}/${value}.svg`;
    return null;
}

function lucideUrl(name) {
    return `${LUCIDE_URL}/icons/${encodeURIComponent(name)}.svg`;
}

// An emoji draws as text in an SVG, so it takes whatever size the spot gives
// an icon and stays a colour glyph
export function iconValueMarkup(value, attributes = '', style = '', className = '') {
    const glyph = emojiText(value);
    if (glyph) {
        const size = EMOJI_GLYPH_RATIO * 100;
        return `<svg class="bti-emoji ${className}" viewBox="0 0 100 100" ${attributes} style="${style}"><text x="50" y="50" font-size="${size}" text-anchor="middle" dominant-baseline="central">${escapeHtml(glyph)}</text></svg>`;
    }
    return `<svg class="bti ${className}" ${attributes} style="${style}--bti:url(${escapeHtml(iconUrl(value) ?? '')})"></svg>`;
}
