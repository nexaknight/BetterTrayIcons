import {badge} from '../components/badge.js';
import {smallButton} from '../components/button.js';
import {iconSubtitle} from '../components/emoji.js';
import {group} from '../components/group.js';
import {CHEVRON, iconButton} from '../components/icon.js';
import {expanderRow} from '../components/expander.js';
import {colorSwatch, entryRow, row, rowIcon, selectRow, spin, switchRow} from '../components/row.js';
import {appById} from '../shared/apps.js';
import {_} from '../shared/i18n.js';
import {iconValueMarkup} from '../shared/iconValues.js';
import {BADGE_MAX_SIZE_PX, state} from '../shared/store.js';
import {escapeHtml} from '../shared/util.js';

// A port of StatusBadgeDialog in src/prefs/dialogs/statusBadgeDialog.js. The
// demo apps never report a state, so no state counts as seen and Attention
// is the only built-in row.
export const STATUS_DIALOG_WIDTH_PX = 480;
export const ATTENTION_STATE_KEY = 'attention';
// The shell clamps a dot's radius to half its size, more would be unreachable
const BADGE_MAX_RADIUS_PX = BADGE_MAX_SIZE_PX / 2;
const RESERVED_STATE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const BADGE_POSITION_OPTIONS = [['bottom-right', _('Bottom Right')], ['bottom-left', _('Bottom Left')], ['top-right', _('Top Right')], ['top-left', _('Top Left')]];
// The rows that show their accent switch, the inline stand-in for the
// accent dialog the real color rows open
const openAccentRows = new Set();
let addingStateFor = null;

export function statusBadgeContent(id) {
    const config = state.appConfigs[id];
    const isBadgeOn = Boolean(config.unreadBadge);
    const unread = switchRow(_('Badges'), `appBadge-${id}`, _('Shows a badge on state changes, with the count when the app sends one.'), {badgeText: _('Experimental')});
    const styleRows = restingRow(id) + positionRow(id) +
        spin(_('Corner Radius (px)'), `appBadgeRadius-${id}`, 0, BADGE_MAX_RADIUS_PX, _('0 is square, high is round.')) +
        spin(_('Size'), `appBadgeSize-${id}`, 0, BADGE_MAX_SIZE_PX, _('0 uses the automatic size.')) +
        colorRowFor(id, _('Background Color'), 'appBadgeColor', 'appBadgeColorAccent') +
        colorRowFor(id, _('Text Color'), 'appBadgeTextColor', 'appBadgeTextColorAccent');
    const sections = isBadgeOn ? group('', styleRows) : group('', stateIconsExpander(id, config));
    return group('', unread) + sections;
}

// The demo has no live frame to take, the button answers like the real one
function restingRow(id) {
    const define = smallButton(_('Define'), `data-badge-resting="${id}"`);
    return row(_('Resting State'), _('Takes what the app shows right now as its calm look.'), define);
}

function positionRow(id) {
    return selectRow(_('Position'), `appBadgePosition-${id}`, BADGE_POSITION_OPTIONS);
}

function colorRowFor(id, title, colorKey, accentKey) {
    const key = `${colorKey}-${id}`;
    const accent = `${accentKey}-${id}`;
    const bucket = iconButton('color', _('More colors'), `data-badge-accent="${accent}" aria-pressed="${openAccentRows.has(accent)}"`);
    const swatch = colorSwatch(key, title, state[accent] ? 'var(--pref-accent)' : state[key], state[accent]);
    const colorRow = row(title, '', bucket + swatch);
    return openAccentRows.has(accent) ? colorRow + switchRow(_('Use Accent Color'), accent) : colorRow;
}

export function toggleAccentRow(accentKey) {
    const wasOpen = openAccentRows.delete(accentKey);
    if (!wasOpen)
        openAccentRows.add(accentKey);
}

function stateIconsExpander(id, config) {
    const add = iconButton('add', _('Add a state'), `data-badge-add-state="${id}"`);
    const names = Object.keys(config.stateIcons ?? {}).filter(name => name !== ATTENTION_STATE_KEY && !RESERVED_STATE_NAMES.has(name));
    const entry = addingStateFor === id
        ? entryRow({id: 'native-state-name', label: _('State name, e.g. state-error'), attributes: `data-badge-state-name="${id}"`})
        : '';
    const rows = stateRow(id, config, ATTENTION_STATE_KEY) + entry + names.map(name => stateRow(id, config, name)).join('');
    const title = `${_('Status Icons')} ${badge(_('Experimental'))}`;
    return expanderRow('status-icons', title, _('Override the icon for app states like attention or sync.'), {suffix: add, rows});
}

function stateRow(id, config, stateKey) {
    const isAttention = stateKey === ATTENTION_STATE_KEY;
    const mapped = config.stateIcons?.[stateKey] ?? null;
    const app = appById(id);
    const preview = rowIcon(mapped ? iconValueMarkup(mapped, 'aria-hidden="true"') : '', {color: app.color});
    const reset = mapped ? iconButton('reset', _('Reset icon'), `data-badge-state-reset="${escapeHtml(stateKey)}" data-app-id="${id}"`) : '';
    const remove = isAttention ? '' : iconButton('trash', _('Remove'), `data-badge-state-remove="${escapeHtml(stateKey)}" data-app-id="${id}"`, 'destructive');
    const unseen = !isAttention && !mapped ? badge(_('Not seen yet')) : '';
    const fallback = isAttention ? _('Applies only when the app itself reports attention.') : _('Automatic');
    const title = isAttention ? _('Attention') : escapeHtml(stateKey);
    return row(title, escapeHtml(iconSubtitle(mapped, fallback)), unseen + reset + remove + CHEVRON, preview,
        `role="button" tabindex="0" data-native-icon-picker="status:${id}:${escapeHtml(stateKey)}"`);
}

export function startAddingState(id) {
    addingStateFor = id;
}

export function addState(id, rawName) {
    const name = rawName.trim();
    addingStateFor = null;
    if (!name)
        return null;
    const config = state.appConfigs[id];
    if (name.toLowerCase() === ATTENTION_STATE_KEY || RESERVED_STATE_NAMES.has(name))
        return _('This name is not allowed.');
    if (config.stateIcons?.[name] !== undefined)
        return _('This state already exists.');
    setStateIcon(id, name, null);
    return null;
}

export function setStateIcon(id, stateKey, value) {
    const config = state.appConfigs[id];
    config.stateIcons = {...config.stateIcons, [stateKey]: value};
}

export function removeStateIcon(id, stateKey) {
    const config = state.appConfigs[id];
    delete config.stateIcons[stateKey];
    if (Object.keys(config.stateIcons).length === 0)
        delete config.stateIcons;
}
