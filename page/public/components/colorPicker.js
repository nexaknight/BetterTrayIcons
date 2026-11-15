import {buttonMarkup, smallButton} from './button.js';
import {bindColorEditor, colorEditorMarkup, editorValue} from './colorEditor.js';
import {trapFocus} from './dialog.js';
import {closeDropdown} from './popover.js';
import {syncInert} from './sidebar.js';
import {toolbar} from './toolbar.js';
import {hidePrefTooltip} from './tooltip.js';
import {root} from './window.js';
import {colorBehindAccent} from '../../../src/shared/accentColor.js';
import {_} from '../shared/i18n.js';
import {update} from '../shared/settings.js';
import {state, ui} from '../shared/store.js';
import {clamp, escapeHtml} from '../shared/util.js';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const LIGHT_LUMA = 150;
const CHECK_ON_LIGHT = '#242428';
const CHECK_ON_DARK = '#fff';
// GTK keeps eight custom colors beside its add button
const MAX_CUSTOM_COLORS = 8;
const DEFAULT_CUSTOM_COLORS = ['transparent', '#ffffff66', '#d5d5d8', '#15151a', '#133047', '#00000055'];

const PALETTE_ROWS = [
    ['#84a6ce', '#7bcd8d', '#d6cf5f', '#dca562', '#d45649', '#bd78be', '#b1947c', '#dbdbdb', '#68676b'],
    ['#568ac8', '#4cc276', '#d5c451', '#db8d41', '#cc2f36', '#a656af', '#9c724f', '#d3d2d1', '#535157'],
    ['#3072c3', '#2eb36a', '#d2b428', '#da6803', '#c01a22', '#7e3a95', '#835c3c', '#bebdbb', '#37323e'],
    ['#1a62b9', '#29a66d', '#d1a611', '#c55503', '#a51b25', '#703787', '#745236', '#a5a4a2', '#221e2d'],
    ['#19539a', '#238b5b', '#c58f0d', '#ab3f04', '#901d2b', '#563072', '#573e29', '#858482', '#040404'],
];

const PALETTE = PALETTE_ROWS.flat();
const PALETTE_STEPS = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -PALETTE_ROWS[0].length, ArrowDown: PALETTE_ROWS[0].length};
const PALETTE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

export function openColorPicker(key, invoker) {
    closeDropdown();
    hidePrefTooltip();
    ui.picker = {key, invoker, draft: colorBehindAccent(String(state[key])) ?? String(state[key]), layer: document.createElement('div')};
    ui.picker.layer.className = 'pref-color-overlay';
    ui.picker.layer.innerHTML = pickerMarkup(invoker.getAttribute('aria-label'));
    ui.picker.layer.querySelector('.ui-toolbar-title').id = 'pref-color-title';
    root.append(ui.picker.layer);
    syncInert();
    ui.picker.layer.querySelector('[data-picker-cancel]').focus({preventScroll: true});
    paintPickerDraft();
}

function pickerMarkup(title) {
    const header = toolbar(escapeHtml(title),
        smallButton(_('Cancel'), 'data-picker-cancel'),
        smallButton(_('Select'), 'data-picker-confirm', 'suggested'),
        'pref-color-toolbar');
    const palette = PALETTE.map((value, i) => pickerSwatch(value, false, i)).join('');
    return `<section class="pref-color-chooser" role="dialog" aria-modal="true" aria-labelledby="pref-color-title">${header}` +
        `<div class="pref-color-content"><div class="pref-palette-grid" role="group" aria-label="${_('Preset colors')}">${palette}</div>` +
        `<p>${_('Custom')}</p><div class="pref-custom-colors" role="group" aria-label="Custom colors">${pickerCustomContent()}</div></div></section>`;
}

function pickerSwatch(value, isCustom, index) {
    const isSelected = ui.picker.draft === value;
    const isFocusable = isCustom || isSelected || index === 0;
    const label = value === 'transparent' ? _('Transparent') : value;
    const checkColor = isLightColor(value) ? CHECK_ON_LIGHT : CHECK_ON_DARK;
    return buttonMarkup({
        variant: `pref-palette-cell ${isCustom ? 'custom' : ''}`,
        leading: `<span aria-hidden="true">${isSelected ? '✓' : ''}</span>`,
        label,
        attributes: `data-picker-value="${escapeHtml(value)}" aria-pressed="${isSelected}" tabindex="${isFocusable ? '0' : '-1'}" style="--swatch:${escapeHtml(value)};--check-color:${checkColor}"`,
    });
}

function isLightColor(value) {
    if (!HEX_COLOR.test(value))
        return false;
    const [red, green, blue] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    return red * 0.2126 + green * 0.7152 + blue * 0.0722 > LIGHT_LUMA;
}

function pickerCustomContent() {
    const swatches = customColors().slice(0, MAX_CUSTOM_COLORS).map((value, i) => pickerSwatch(value, true, i)).join('');
    const addLabel = _('Add custom color');
    return buttonMarkup({variant: 'pref-custom-add', title: '+', label: addLabel, attributes: `data-picker-add data-pref-tooltip="${addLabel}"`}) + swatches;
}

function customColors() {
    return state.customColors || DEFAULT_CUSTOM_COLORS;
}

export function pickDraft(value) {
    ui.picker.draft = value;
    paintPickerDraft();
}

function paintPickerDraft() {
    for (const button of ui.picker.layer.querySelectorAll('[data-picker-value]')) {
        const isSelected = button.dataset.pickerValue === ui.picker.draft;
        button.setAttribute('aria-pressed', String(isSelected));
        button.querySelector('span').textContent = isSelected ? '✓' : '';
        if (!button.classList.contains('custom'))
            button.tabIndex = isSelected ? 0 : -1;
    }
    if (!ui.picker.layer.querySelector('.pref-palette-grid [tabindex="0"]'))
        ui.picker.layer.querySelector('.pref-palette-grid button').tabIndex = 0;
}

// The "+" turns the chooser into its editor, as GtkColorChooserWidget does
export function openColorEditor() {
    const content = ui.picker.layer.querySelector('.pref-color-content');
    content.innerHTML = colorEditorMarkup(ui.picker.draft);
    bindColorEditor(content.firstElementChild);
    ui.picker.isEditing = true;
    content.querySelector('[data-editor-control="plane"]').focus({preventScroll: true});
}

export function closeColorPicker(shouldCommit = false) {
    const {key, invoker, layer, isEditing} = ui.picker;
    const draft = isEditing ? editorValue() : ui.picker.draft;
    if (shouldCommit && isEditing)
        rememberCustomColor(draft);
    layer.remove();
    ui.picker = null;
    syncInert();
    if (shouldCommit) {
        update(key, draft);
        root.querySelector(`[data-color-picker="${key}"]`).focus({preventScroll: true});
        return;
    }
    if (invoker.isConnected)
        invoker.focus({preventScroll: true});
}

// A color picked in the editor joins the Custom row, newest first
function rememberCustomColor(value) {
    state.customColors = [value, ...customColors().filter(color => color !== value)].slice(0, MAX_CUSTOM_COLORS);
}

export function onPickerKey(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeColorPicker();
        return;
    }
    const swatch = event.target.closest('.pref-palette-grid [data-picker-value]');
    if (swatch && PALETTE_KEYS.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        moveSwatchFocus(swatch, event.key);
        return;
    }
    if (event.key === 'Tab')
        trapFocus(event, [...ui.picker.layer.querySelectorAll('button:not([tabindex="-1"]), input, [data-editor-control]')]);
}

function moveSwatchFocus(swatch, key) {
    const buttons = [...ui.picker.layer.querySelectorAll('.pref-palette-grid button')];
    const next = swatchIndexFor(key, buttons.indexOf(swatch), buttons.length - 1);
    buttons.forEach(button => (button.tabIndex = -1));
    buttons[next].tabIndex = 0;
    buttons[next].focus({preventScroll: true});
}

function swatchIndexFor(key, index, last) {
    if (key === 'Home')
        return 0;
    if (key === 'End')
        return last;
    return clamp(index + PALETTE_STEPS[key], 0, last);
}
