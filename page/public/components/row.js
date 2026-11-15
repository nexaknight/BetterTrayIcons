import {badge} from './badge.js';
import {helpButton} from './help.js';
import {CHEVRON, gearButton, icon, iconButton} from './icon.js';
import {rangeSlider} from './range.js';
import {_} from '../shared/i18n.js';
import {colorBehindAccent, usesAccent} from '../../../src/shared/accentColor.js';
import {editedColorKey} from '../../../src/shared/colorVariant.js';
import {settings, state} from '../shared/store.js';
import {escapeHtml} from '../shared/util.js';
import {buttonMarkup} from './button.js';

const SPIN_DEFAULT_MAX = 20;

// Two digits of room even when the range starts at one, the position row
// grows its upper bound with the app count
const SPIN_MIN_WIDTH_CHARS = 2;

export function row(title, subtitle = '', suffix = '', prefix = '', attributes = '', below = '') {
    const tag = attributes.includes('type="button"') ? 'button' : 'div';
    const suffixMarkup = suffix ? `<span class="pref-row-suffix">${suffix}</span>` : '';
    return `<${tag} class="pref-row" ${attributes}>${prefix}${rowCopy(title, subtitle, below)}${suffixMarkup}</${tag}>`;
}

// below sits under the subtitle, createBadgedActionRow's badge line
export function rowCopy(title, subtitle = '', below = '') {
    const subtitleMarkup = subtitle ? `<span class="pref-row-subtitle">${subtitle}</span>` : '';
    return `<span class="pref-row-copy"><span class="pref-row-title">${title}</span>${subtitleMarkup}${below}</span>`;
}

export function rowIcon(markup, {color = '', tooltip = ''} = {}) {
    const style = color ? `style="color:${color}"` : '';
    const tooltipMarkup = tooltip ? `data-pref-tooltip="${tooltip}"` : '';
    return `<span class="pref-row-icon" ${style} ${tooltipMarkup}>${markup}</span>`;
}

export function loadingRow() {
    return row(_('Loading…'), '', '<span class="pref-spinner" aria-hidden="true"></span>');
}

// createEntryRow in src/prefs/components/row.js, a reset takes the place of
// Adwaita's pencil and goes disabled at reset.value
export function entryRow({id, label, value = '', attributes = '', suffix = '', className = '', ariaLabel = label, reset = null}) {
    const hint = reset
        ? iconButton('reset', _('Reset'), `${reset.attributes} ${value === reset.value ? 'disabled' : ''}`)
        : icon('edit', 'pref-entry-edit');
    return `<div class="pref-row ${className}"><span class="pref-entry-row"><label for="${id}">${label}</label>` +
        `<input class="pref-input" id="${id}" value="${escapeHtml(value)}" ${attributes} aria-label="${ariaLabel}"></span>` +
        `<span class="pref-entry-suffix">${hint}${suffix}</span></div>`;
}

// The gear leads the suffixes and goes insensitive with the switch unless
// the dialog matters while it is off
export function switchRow(title, key, subtitle = '', {dialog = '', isGearAlwaysLive = false, help = '', badgeText = ''} = {}) {
    const isGearLive = isGearAlwaysLive || state[key];
    const gear = dialog ? gearButton(`${_('Configure')} ${title}`, `data-dialog="${dialog}" ${isGearLive ? '' : 'disabled'}`) : '';
    const helpMarkup = (help ? helpButton(help) : '') + (badgeText ? badge(badgeText) : '');
    return row(title, subtitle, helpMarkup + gear + switchButton(title, `aria-checked="${Boolean(state[key])}" data-pref-switch="${key}"`));
}

export function switchButton(label, attributes) {
    return buttonMarkup({variant: 'pref-switch', label, attributes: `role="switch" ${attributes}`});
}

// A locked spin shows its minimum and takes no input, the stored value waits
export function spin(title, key, min = 0, max = SPIN_DEFAULT_MAX, subtitle = '', {isLocked = false} = {}) {
    return row(title, subtitle, spinButton(title, key, min, max, isLocked));
}

// The field holds the widest bound so the pill stays still while the digit
// count changes, like width_chars in createSpinRow
function spinButton(title, key, min, max, isLocked = false) {
    const value = isLocked ? min : state[key];
    const widthChars = Math.max(SPIN_MIN_WIDTH_CHARS, String(max).length);
    const data = `data-pref-step="${key}" data-min="${min}" data-max="${max}"`;
    const down = buttonMarkup({variant: 'pref-spin-down', label: `${_('Decrease')} ${title}`, attributes: `${data} data-delta="-1" ${isLocked || value <= min ? 'disabled' : ''}`});
    const up = buttonMarkup({variant: 'pref-spin-up', label: `${_('Increase')} ${title}`, attributes: `${data} data-delta="1" ${isLocked || value >= max ? 'disabled' : ''}`});
    return `<span class="pref-stepper" style="--spin-chars:${widthChars}"><input type="number" class="pref-spin-entry" value="${value}" min="${min}" max="${max}" aria-label="${escapeHtml(title)}" data-pref-range="${key}" ${isLocked ? 'disabled' : ''}>${down}${up}</span>`;
}

// One value drives the slider and the number, like the shared adjustment of
// createRangeRow in src/prefs/components/row.js
export function rangeRow(title, key, min, max, subtitle = '') {
    const slider = rangeSlider(title, min, max, state[key], `data-pref-range="${key}"`);
    return wrapRow(title, subtitle, slider + spinButton(title, key, min, max), '', 'stretch');
}

export function segmented(title, key, options, subtitle = '') {
    return row(title, subtitle, segmentGroup(title, key, options));
}

export function negateButton({key, iconName, label}) {
    return iconButton(iconName, label, `data-pref-switch="${key}" aria-pressed="${state[key]}"`, state[key] ? 'active' : '');
}

export function segmentGroup(label, key, options, {labelPrefix = '', isDisabled = false, className = '', selected = state[key], buttonAttributes = value => `data-pref-set="${key}" data-value="${value}"`} = {}) {
    const buttons = options.map(([value, text]) =>
        buttonMarkup({title: `${labelPrefix}${text}`, attributes: `${buttonAttributes(value)} aria-pressed="${selected === value}" ${isDisabled ? 'disabled' : ''}`})
    ).join('');
    return `<span class="pref-segmented ${className}" role="group" aria-label="${escapeHtml(label)}">${buttons}</span>`;
}

// These rows keep their text whole, the controls drop as soon as the title
// would have to wrap beside them (keepTextWhole in src/prefs/components/row.js)
export function toggleGroupRow(title, key, options, {subtitle = '', badgeText = '', help = '', isSensitive = true} = {}) {
    const controls = (badgeText ? badge(badgeText) : '') + segmentGroup(title, key, options, {isDisabled: !isSensitive});
    return wrapRow(title, subtitle, controls, help, isSensitive ? 'whole' : 'whole insensitive');
}

export function selectRow(title, key, options, subtitle = '', {hasGear = false, help = '', selected = state[key], isNaturalWidth = false} = {}) {
    const gear = hasGear ? gearButton(_('Configure advanced actions'), `data-action-gear="${key}"`, 'pref-action-gear') : '';
    // A bare option is a stored action name shown translated, a pair brings its own label
    const labeled = options.map(option => Array.isArray(option) ? {value: option[0], label: option[1]} : {value: option, label: _(option)});
    const shown = labeled.find(option => option.value === selected) ?? labeled[0];
    const button = buttonMarkup({
        variant: 'pref-select-trigger',
        title: `<span>${escapeHtml(shown.label)}</span>`,
        trailing: '<span class="pref-select-arrow" aria-hidden="true"></span>',
        label: title,
        attributes: `role="combobox" aria-haspopup="listbox" aria-expanded="false" data-pref-select-trigger="${key}" data-pref-options="${escapeHtml(JSON.stringify(labeled))}"`,
    });
    const trigger = `<span class="pref-select-wrap ${isNaturalWidth ? 'natural' : ''}">${button}</span>`;
    return wrapRow(title, subtitle, gear + trigger, help);
}

// Controls that drop under the text in a narrow row, the WrapRowLayout in
// src/prefs/components/row.js. The help shares the title line so it stays up.
function wrapRow(title, subtitle, controls, help = '', className = '') {
    const titleLine = help ? `<span class="pref-row-title-line"><span class="pref-row-title">${title}</span>${helpButton(help, true)}</span>` : `<span class="pref-row-title">${title}</span>`;
    const subtitleMarkup = subtitle ? `<span class="pref-row-subtitle">${subtitle}</span>` : '';
    return `<div class="pref-row pref-wrap-row ${className}"><span class="pref-row-copy">${titleLine}${subtitleMarkup}</span><span class="pref-row-suffix">${controls}</span></div>`;
}

export function subRow(title, subtitle, key, iconName) {
    return row(title, subtitle, CHEVRON, icon(iconName), `type="button" data-pref-subpage="${key}"`);
}

export function colorSwatch(key, label, value, isDisabled = false) {
    return buttonMarkup({variant: 'pref-color', leading: '<span aria-hidden="true"></span>', label, attributes: `data-color-picker="${key}" data-pref-tooltip="${escapeHtml(label)}" style="--swatch:${escapeHtml(value)}" ${isDisabled ? 'disabled' : ''}`});
}

// The paint bucket opens the accent and hover options, _createColorRow in
// src/prefs/components/row.js. The swatch edits the color set being edited
// and rests while the accent stands in for it.
export function colorRow(title, key) {
    return row(title, '', iconButton('color', _('More colors'), `data-dialog="color:${key}"`) + editedColorSwatch(key, title));
}

export function editedColorSwatch(key, title) {
    const edited = editedColorKey(settings, key);
    return colorSwatch(edited, title, colorBehindAccent(state[edited]) ?? state[edited], usesAccent(state[edited]));
}

// _createAccentSwitchRow, the switch keeps the replaced color behind the accent
export function accentSwitchRow(title, key) {
    const edited = editedColorKey(settings, key);
    return row(title, '', switchButton(title, `aria-checked="${usesAccent(state[edited])}" data-accent-switch="${edited}"`));
}
