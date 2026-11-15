import {_} from '../shared/i18n.js';
import {colorRow, rangeRow, row, segmentGroup, switchButton, switchRow} from './row.js';
import {spacingCards} from './spacing.js';
import {COLOR_VARIANT_KEY} from '../../../src/shared/colorVariant.js';
import {isPanelMode, state} from '../shared/store.js';
import {STYLE_KINDS} from '../shared/styleDefaults.js';

const BORDER_RADIUS_MAX_PX = 50;
const BORDER_WIDTH_MAX_PX = 20;
const BLUR_MAX = 100;

export function group(title, rows, description = '', className = '') {
    return groupSection(title, rowList(rows), description, className);
}

export function rowList(rows) {
    return `<div class="pref-list">${rows}</div>`;
}

// The header_suffix of Adw.PreferencesGroup, buttons at the right of the title
export function groupHeading(title, actions) {
    const heading = title ? `<h3>${title}</h3>` : '';
    return `<header class="pref-group-heading ui-toolbar">${heading}<div>${actions}</div></header>`;
}

export function groupSection(title, content, description = '', className = '') {
    const heading = title ? `<h3>${title}</h3>` : '';
    const descriptionMarkup = description ? `<p class="pref-description">${description}</p>` : '';
    return `<section class="pref-group ${className}">${heading}${descriptionMarkup}${content}</section>`;
}

// Quick Settings rows take the menu item style, so only the icon tint
// carries over there, as trayIconsSubpage.js hides the box controls
export function styleGroups(kind) {
    const {customKey, colorPrefix, blurKey} = STYLE_KINDS[kind];
    const hasBox = kind !== 'icons' || isPanelMode();
    const blur = state[customKey] && hasBox ? rangeRow(_('Background Blur'), blurKey, 0, BLUR_MAX, _('Blurs what lies behind it.')) : '';
    const styleGroup = group(_('Style'), switchRow(_('Custom Style'), customKey, _('Reveal the style controls below.')) + blur);
    if (!state[customKey])
        return styleGroup;

    const canInherit = kind === 'toggle' && state['enable-custom-icon-style'];
    const inheritGroup = canInherit ? group('', switchRow(_('Inherit Style from Tray Icons'), 'toggle-inherit-icon-style', _('Match the look of tray icons. Hides the controls below.'))) : '';
    if (canInherit && state['toggle-inherit-icon-style'])
        return styleGroup + inheritGroup;
    if (!hasBox)
        return styleGroup + colorsGroup(kind, false);

    const shape = rangeRow(_('Corner Radius (px)'), `${colorPrefix}-border-radius`, 0, BORDER_RADIUS_MAX_PX) +
        rangeRow(_('Border Width (px)'), `${colorPrefix}-border-width`, 0, BORDER_WIDTH_MAX_PX);
    return styleGroup + inheritGroup + colorsGroup(kind, true) + groupSection(_('Spacing'), spacingCards(kind)) + group(_('Shape'), shape);
}

// createColorSetRow and createIconColorRows in src/prefs/components/row.js
function colorsGroup(kind, hasBox) {
    const {colorPrefix} = STYLE_KINDS[kind];
    const splitKey = `${colorPrefix}-color-split`;
    const isSplit = state[splitKey];
    const colorSet = isSplit ? segmentGroup(_('Color Set'), COLOR_VARIANT_KEY, [['dark', _('Dark')], ['light', _('Light')]]) : '';
    const splitLabel = _('Separate colors for the light and dark style.');
    const splitSwitch = switchButton(splitLabel, `aria-checked="${isSplit}" data-pref-switch="${splitKey}"`);
    const iconColor = kind === 'overflow' ? '' : colorRow(_('Icon'), `${colorPrefix}-color`);
    const boxColors = hasBox ? colorRow(_('Background'), `${colorPrefix}-background-color`) + colorRow(_('Border'), `${colorPrefix}-border-color`) : '';
    return group(_('Colors'), row(_('Color Set'), splitLabel, colorSet + splitSwitch) + iconColor + boxColors);
}
