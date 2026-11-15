import {icon, iconButton} from './icon.js';
import {hidePrefTooltip} from './tooltip.js';
import {root} from './window.js';
import {_} from '../shared/i18n.js';
import {schedulePersist} from '../shared/persist.js';
import {state} from '../shared/store.js';
import {STYLE_KINDS} from '../shared/styleDefaults.js';
import {applyTrayTheme} from '../shared/trayTheme.js';
import {clamp} from '../shared/util.js';
import {buttonMarkup} from './button.js';

const SPACING_MAX = 50;
const SPACING_TYPES = ['Margin', 'Padding'];
const SPACING_SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const SPACING_LABELS = {Margin: _('Margin'), Padding: _('Padding'), Top: _('Top'), Right: _('Right'), Bottom: _('Bottom'), Left: _('Left')};

export function spacingCards(kind) {
    const cards = SPACING_TYPES.map(type => spacingCard(kind, type)).join('');
    return `<div class="pref-spacing-cards">${cards}</div>`;
}

function spacingCard(kind, type) {
    const isLinked = state[linkKey(kind, type)];
    const linkButton = iconButton(isLinked ? 'link' : 'unlink', linkLabel(isLinked), `data-spacing-link="${kind}" data-spacing-type="${type}" aria-pressed="${isLinked}"`, isLinked ? 'linked' : '');
    const sides = SPACING_SIDES.map(side => spacingSideControl(kind, type, side, state[sideKey(kind, type, side)])).join('');
    return `<div class="pref-spacing-card"><header class="ui-toolbar pref-spacing-header"><strong>${SPACING_LABELS[type]}</strong>${linkButton}</header>` +
        `<div class="pref-spacing-dial">${sides}<span class="pref-spacing-sketch ${type.toLowerCase()}" aria-hidden="true"><i></i></span></div></div>`;
}

function spacingSideControl(kind, type, side, value) {
    const data = `data-spacing-kind="${kind}" data-spacing-type="${type}" data-spacing-side="${side}"`;
    const label = `${SPACING_LABELS[type]} ${SPACING_LABELS[side]}`;
    const down = buttonMarkup({title: '−', label: `${_('Decrease')} ${label}`, attributes: `data-spacing-step="-1" ${data} ${value === 0 ? 'disabled' : ''}`});
    const up = buttonMarkup({title: '+', label: `${_('Increase')} ${label}`, attributes: `data-spacing-step="1" ${data} ${value === SPACING_MAX ? 'disabled' : ''}`});
    return `<label class="${side.toLowerCase()}"><span class="pref-spacing-spin">` +
        `<input type="number" min="0" max="${SPACING_MAX}" value="${value}" aria-label="${label}" ${data}>${down}${up}` +
        `</span><span>${SPACING_LABELS[side]}</span></label>`;
}

function linkLabel(isLinked) {
    return isLinked ? _('Unlink: edit each side on its own') : _('Link: editing one side sets all four');
}

export function stepSpacing(button) {
    const {spacingKind, spacingType, spacingSide: side} = button.dataset;
    const current = state[sideKey(spacingKind, spacingType, side)];
    setSpacing(spacingKind, spacingType, side, current + Number(button.dataset.spacingStep));
}

export function setSpacing(kind, type, side, value) {
    const amount = clamp(Math.round(Number(value) || 0), 0, SPACING_MAX);
    const sides = state[linkKey(kind, type)] ? SPACING_SIDES : [side];
    for (const name of sides)
        state[sideKey(kind, type, name)] = amount;
    for (const input of root.querySelectorAll(`input[data-spacing-kind="${kind}"][data-spacing-type="${type}"]`)) {
        const sideValue = state[sideKey(kind, type, input.dataset.spacingSide)];
        input.value = sideValue;
        input.parentElement.querySelector('[data-spacing-step="-1"]').disabled = sideValue === 0;
        input.parentElement.querySelector('[data-spacing-step="1"]').disabled = sideValue === SPACING_MAX;
    }
    applyTrayTheme();
    schedulePersist();
}

export function toggleSpacingLink(button) {
    const {spacingLink: kind, spacingType: type} = button.dataset;
    const isLinked = !state[linkKey(kind, type)];
    const label = linkLabel(isLinked);
    state[linkKey(kind, type)] = isLinked;
    schedulePersist();
    button.setAttribute('aria-pressed', String(isLinked));
    button.classList.toggle('linked', isLinked);
    button.innerHTML = icon(isLinked ? 'link' : 'unlink');
    button.setAttribute('aria-label', label);
    button.dataset.prefTooltip = label;
    hidePrefTooltip();
}

function sideKey(kind, type, side) {
    return `${STYLE_KINDS[kind].spacingPrefix}-${type.toLowerCase()}-${side.toLowerCase()}`;
}

function linkKey(kind, type) {
    return `${STYLE_KINDS[kind].spacingPrefix}-${type.toLowerCase()}-linked`;
}
