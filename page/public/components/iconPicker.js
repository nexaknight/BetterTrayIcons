import {loadEmojiCatalog} from './emoji.js';
import {iconButton} from './icon.js';
import {COLUMNS, MODE_EMOJI, SectionGrid, pickerTab} from './pickerGrid.js';
import {closeDropdown, openPopover} from './popover.js';
import {segmentGroup} from './row.js';
import {_} from '../shared/i18n.js';
import {CUSTOM_SAMPLE_PATH, EMOJI_PREFIX, LUCIDE_PREFIX, LUCIDE_URL, iconValueMarkup, isEmojiValue} from '../shared/iconValues.js';
import {rememberEmoji, ui} from '../shared/store.js';
import {escapeHtml, fetchJson} from '../shared/util.js';

// A port of IconEmojiPicker in src/prefs/components/iconEmojiPicker.js. The
// icons come from Lucide over the CDN instead of the system theme and icon
// packs, and the folder button sets a sample file instead of a file dialog.
const COLUMN_WIDTH_PX = 40;
const PICKER_PADDING_PX = 8;
const MODE_ICONS = 'icons';
const MODE_CUSTOM = 'custom';
const KIND_SYMBOLIC = 'symbolic';
const KIND_COLORED = 'colored';

const MODES = [
    {name: MODE_ICONS, iconName: 'image', title: _('Icons')},
    {name: MODE_EMOJI, iconName: 'smile', title: _('Emojis')},
    {name: MODE_CUSTOM, iconName: 'folder-search', title: _('Custom')},
];

const EMOJI_GROUPS = [
    {iconName: 'smile', title: _('Smileys & People')},
    {iconName: 'paw-print', title: _('Animals & Nature')},
    {iconName: 'apple', title: _('Food & Drink')},
    {iconName: 'plane', title: _('Travel & Places')},
    {iconName: 'trophy', title: _('Activities')},
    {iconName: 'lightbulb', title: _('Objects')},
    {iconName: 'hash', title: _('Symbols')},
    {iconName: 'flag', title: _('Flags')},
];

let lucideIcons = null;

/**
 * Opens the picker under a row, onSelect receives the picked icon value.
 *
 * @param {HTMLElement} anchor Row the picker hangs from.
 * @param {object} options Current value, recommended repo icons and the pick handler.
 */
export function openIconPicker(anchor, {current = '', icons = [], onSelect}) {
    const footer = MODES.map(mode => pickerTab(mode.title, mode.iconName, `data-picker-mode="${mode.name}"`)).join('');
    const markup = `<div class="pref-picker-stack"></div><div class="pref-picker-footer">${footer}</div>`;
    const popover = openPopover(anchor, markup, 'dialog', 'pref-icon-picker', {width: COLUMNS * COLUMN_WIDTH_PX + 2 * PICKER_PADDING_PX});
    if (!popover)
        return;
    const picker = {popover, current, icons, onSelect, grids: {}, panes: {}};
    popover.addEventListener('click', event => onPickerClick(event, picker));
    popover.addEventListener('keydown', event => onPickerKey(event, picker));
    popover.addEventListener('input', event => onCustomInput(event, picker));
    showMode(picker, initialMode(current));
}

function initialMode(current) {
    if (isEmojiValue(current))
        return MODE_EMOJI;
    if (current.startsWith('/'))
        return MODE_CUSTOM;
    return MODE_ICONS;
}

function showMode(picker, name) {
    picker.panes[name] ??= buildMode(picker, name);
    for (const [mode, pane] of Object.entries(picker.panes))
        pane.hidden = mode !== name;
    for (const tab of picker.popover.querySelectorAll('[data-picker-mode]'))
        tab.setAttribute('aria-pressed', String(tab.dataset.pickerMode === name));
}

function buildMode(picker, name) {
    const pane = document.createElement('div');
    pane.className = `pref-picker-pane ${name}`;
    picker.popover.querySelector('.pref-picker-stack').append(pane);
    if (name === MODE_ICONS)
        buildIconsMode(picker, pane);
    else if (name === MODE_EMOJI)
        buildEmojiMode(picker, pane);
    else
        buildCustomMode(picker, pane);
    return pane;
}

// Symbolic and coloured icons are two lists behind a switch. Lucide ships
// no coloured set, so the coloured side shows the same icons in the accent.
function buildIconsMode(picker, pane) {
    const kinds = segmentGroup(_('Icon kind'), '', [[KIND_SYMBOLIC, _('Symbolic')], [KIND_COLORED, _('Colored')]],
        {className: 'pref-picker-kinds', selected: KIND_SYMBOLIC, buttonAttributes: kind => `data-picker-kind="${kind}"`});
    pane.innerHTML = kinds;
    for (const kind of [KIND_SYMBOLIC, KIND_COLORED]) {
        const grid = createIconGrid(picker);
        grid.element.dataset.kind = kind;
        grid.element.hidden = kind !== KIND_SYMBOLIC;
        pane.append(grid.element);
        picker.grids[kind] = grid;
    }
    // Nothing loads from the CDN before the picker opens
    lucideIcons ??= fetchJson(`${LUCIDE_URL}/tags.json`);
    lucideIcons.then(tags => {
        for (const kind of [KIND_SYMBOLIC, KIND_COLORED]) {
            picker.grids[kind].setSections(iconSections(picker.icons, tags, kind === KIND_COLORED ? 'colored' : ''));
            picker.grids[kind].scrollToValue(picker.current);
        }
    }).catch(() => {
        lucideIcons = null;
        picker.grids[KIND_SYMBOLIC].setSections(iconSections(picker.icons, {}, ''));
    });
}

function createIconGrid(picker) {
    return new SectionGrid({
        kind: MODE_ICONS,
        current: picker.current,
        onPick: value => pick(picker, value),
        searchPlaceholder: _('Search icons…'),
        emptyTitle: _('No Icons Found'),
        showTabs: false,
    });
}

function iconSections(recommended, tags, tint) {
    const sections = [];
    if (recommended.length)
        sections.push({id: 'recommended', iconName: 'star', title: _('Recommended'), tint, items: recommended.map(name => iconItem(name, name, []))});
    for (const [name, words] of Object.entries(tags)) {
        const letter = name[0].toUpperCase();
        if (sections.at(-1)?.id !== letter)
            sections.push({id: letter, iconName: 'image', title: `Lucide · ${letter}`, tint, items: []});
        sections.at(-1).items.push(iconItem(`${LUCIDE_PREFIX}${name}`, name, words));
    }
    return sections;
}

function iconItem(value, name, words) {
    return {value, name, search: ` ${name.replace(/[-_.]/g, ' ')} ${words.join(' ')}`.toLowerCase()};
}

function buildEmojiMode(picker, pane) {
    const grid = new SectionGrid({
        kind: MODE_EMOJI,
        current: picker.current,
        onPick: value => pick(picker, value),
        searchPlaceholder: _('Search emojis…'),
        emptyTitle: _('No Emojis Found'),
    });
    pane.append(grid.element);
    picker.grids[MODE_EMOJI] = grid;
    loadEmojiCatalog().then(catalog => {
        const sections = EMOJI_GROUPS.map((group, index) => ({id: String(index), ...group, items: []}));
        for (const emoji of catalog)
            sections[emoji.group].items.push(emoji);
        const byValue = new Map(catalog.map(emoji => [emoji.value, emoji]));
        const recent = ui.recentEmojis.map(hex => byValue.get(`${EMOJI_PREFIX}${hex}`)).filter(Boolean);
        sections.unshift({id: 'recent', iconName: 'clock', title: _('Recent'), items: recent});
        grid.setSections(sections);
        grid.scrollToValue(picker.current);
    }).catch(() => {});
}

function buildCustomMode(picker, pane) {
    const value = picker.current && !isEmojiValue(picker.current) ? picker.current : '';
    const shownText = value.startsWith(LUCIDE_PREFIX) ? value.slice(LUCIDE_PREFIX.length) : value;
    const entry = `<input class="pref-input" data-picker-entry placeholder="${_('Icon name or path')}" aria-label="${_('Icon name or path')}" value="${escapeHtml(shownText)}">`;
    const buttons = iconButton('folder', _('Choose file'), 'data-picker-file', 'pref-picker-file') + iconButton('select', _('Apply'), 'data-picker-apply', 'pref-picker-apply');
    pane.innerHTML = `<span class="pref-picker-preview">${value ? iconValueMarkup(value, 'aria-hidden="true"') : ''}</span>` +
        `<p class="pref-picker-hint">${_('Type a name or pick an SVG/PNG file.')}</p><span class="pref-picker-input">${entry}${buttons}</span>`;
}

function onPickerClick(event, picker) {
    const mode = event.target.closest('[data-picker-mode]');
    const kind = event.target.closest('[data-picker-kind]');
    if (mode)
        showMode(picker, mode.dataset.pickerMode);
    else if (kind)
        showIconKind(picker, kind.dataset.pickerKind);
    else if (event.target.closest('[data-picker-file]'))
        fillSampleFile(picker);
    else if (event.target.closest('[data-picker-apply]'))
        applyEntry(picker);
}

function showIconKind(picker, kind) {
    for (const button of picker.popover.querySelectorAll('[data-picker-kind]'))
        button.setAttribute('aria-pressed', String(button.dataset.pickerKind === kind));
    for (const [name, grid] of Object.entries(picker.grids))
        grid.element.hidden = name !== kind && name !== MODE_EMOJI;
}

// The sample file lands in the entry like a chosen file would, applying stays with the apply button
function fillSampleFile(picker) {
    const entry = picker.popover.querySelector('[data-picker-entry]');
    entry.value = CUSTOM_SAMPLE_PATH;
    showCustomPreview(picker, CUSTOM_SAMPLE_PATH);
    entry.focus({preventScroll: true});
}

function applyEntry(picker) {
    const value = entryValue(picker.popover.querySelector('[data-picker-entry]').value);
    if (value)
        pick(picker, value);
}

// The entry takes a Lucide name the way the real one takes a theme icon name
function entryValue(text) {
    const value = text.trim();
    const isPathOrPrefixed = value.startsWith('/') || value.includes(':') || value.startsWith('bti-');
    const isPlainName = value && !isPathOrPrefixed;
    return isPlainName ? `${LUCIDE_PREFIX}${value}` : value;
}

// Escape stays with the popover code, everything else belongs to the picker
function onPickerKey(event, picker) {
    if (event.key === 'Escape')
        return;
    event.stopPropagation();
    if (event.key === 'Enter' && event.target.matches('[data-picker-entry]')) {
        applyEntry(picker);
        return;
    }
    const grid = Object.values(picker.grids).find(candidate => candidate.element.contains(event.target));
    if (grid?.moveFocus(event.key))
        event.preventDefault();
}

function onCustomInput(event, picker) {
    if (event.target.matches('[data-picker-entry]'))
        showCustomPreview(picker, entryValue(event.target.value));
}

function showCustomPreview(picker, value) {
    picker.panes[MODE_CUSTOM].querySelector('.pref-picker-preview').innerHTML = value ? iconValueMarkup(value, 'aria-hidden="true"') : '';
}

function pick(picker, value) {
    if (isEmojiValue(value))
        rememberEmoji(value.slice(EMOJI_PREFIX.length));
    closeDropdown(true);
    for (const grid of Object.values(picker.grids))
        grid.release();
    picker.onSelect(value);
}
