import {DESKTOP_INSET_PX} from '../landing/tray.js';
import {editsLightSet} from '../../../src/shared/colorVariant.js';
import {settings} from './store.js';
import {blurCss, computeOverflowStyle, computeToggleStyle, computeTrayIconStyle, popupUsesLightStyle, styleRules} from './trayStyle.js';

// One sheet for the landing tray and the demo's preview, both painted from
// the strings of trayStyle.js. The landing panel is always dark, as the
// shell's top bar is, the popup and the preview follow the edited set.
const SHEET_ID = 'bti-tray-theme';
const PANEL_ICONS = '#desktop :is(#tray-inline, #tray-drawer-icons) .tray-icon';
const POPUP_ICONS = '#desktop #overflow-icons .tray-icon';
const PANEL_TOGGLE = '#desktop #tray-toggle';
const POPUP = '#desktop #overflow';
const PREVIEW = '.prefs-native .pref-preview-stage';
// A custom box sizes itself from its padding, as the shell's does
const AUTO_SIZE = ' width: auto; height: auto;';

// The space the tray keeps from the clock, the panel's column gap
const CLOCK_CLEARANCE_PX = 12;

// Two passes, the second measures the boxes the first one restyled
export function applyTrayTheme() {
    writeSheet();
    requestAnimationFrame(writeSheet);
}

function writeSheet() {
    let sheet = document.getElementById(SHEET_ID);
    if (!sheet) {
        sheet = document.createElement('style');
        sheet.id = SHEET_ID;
        document.head.append(sheet);
    }
    const limits = measureLimits();
    sheet.textContent = [...landingRules(limits), ...previewRules(limits)].filter(Boolean).join('\n');
}

// What the bar and the desktop leave for spacing, see clampedSpacing in trayStyle.js
function measureLimits() {
    const panel = document.querySelector('#desktop .panel');
    const clock = document.querySelector('#panel-clock');
    const indicator = document.querySelector('#bti-indicator');
    const desktop = document.querySelector('#desktop');
    const border = prefix => 2 * settings.get_int(`${prefix}-border-width`);
    const items = [...document.querySelectorAll('#tray-inline .tray-icon, #tray-toggle, #tray-drawer:not([hidden]) .tray-icon')];
    const itemsWidth = items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0);
    // The clock's resting place, the panel centre, a wider tray would push it
    const bar = panel.getBoundingClientRect();
    const clockRight = bar.left + bar.width / 2 + clock.getBoundingClientRect().width / 2;
    const room = indicator.getBoundingClientRect().right - clockRight - CLOCK_CLEARANCE_PX;
    const inlineMargin = Math.max(0, (room - itemsWidth) / (2 * Math.max(1, items.length)));
    const panelLimits = (content, prefix) => ({blockSize: panel.clientHeight, content: content + border(prefix), inlineMargin});

    const iconSize = settings.get_int('iconSize');
    const count = document.querySelectorAll('#overflow-icons .tray-icon').length || 1;
    const columns = settings.get_string('layout') === 'grid' ? Math.min(settings.get_int('gridColumns'), count) : count;
    const iconBox = iconSize + settings.get_int('icon-padding-left') + settings.get_int('icon-padding-right') + border('icon');
    const popupItem = (desktop.clientWidth - DESKTOP_INSET_PX) / columns;
    return {
        icon: panelLimits(iconSize, 'icon'),
        toggle: panelLimits(settings.get_int('toggleSize'), 'toggle-icon'),
        popup: {inlineMargin: Math.max(0, (popupItem - iconBox) / 2)},
    };
}

function landingRules(limits) {
    const popupLight = popupUsesLightStyle(settings, editsLightSet(settings));
    return [
        ...iconRules(PANEL_ICONS, computeTrayIconStyle(settings, {light: false, inPanel: true, limits: limits.icon})),
        ...iconRules(POPUP_ICONS, computeTrayIconStyle(settings, {light: popupLight, limits: limits.popup})),
        ...toggleRules(PANEL_TOGGLE, computeToggleStyle(settings, false, limits.toggle), settings.get_int('toggle-blur')),
        boxRules(POPUP, computeOverflowStyle(settings, popupLight), settings.get_int('overflow-container-blur')),
    ];
}

// The preview shows the set being edited, as the prefs preview scenes do,
// clamped by the landing's bar so both draw the same box
function previewRules(limits) {
    const editsLight = key => settings.get_boolean(key) && editsLightSet(settings);
    const iconLight = editsLight('icon-color-split');
    return [
        ...iconRules(`${PREVIEW}[data-preview-kind=icons] [data-guide-target]`, computeTrayIconStyle(settings, {light: iconLight, inPanel: true, limits: limits.icon})),
        ...iconRules(`${PREVIEW}[data-preview-kind=toggle] > span`, computeTrayIconStyle(settings, {light: iconLight, inPanel: true, limits: limits.icon})),
        ...toggleRules(`${PREVIEW} .pref-preview-toggle`, computeToggleStyle(settings, editsLight('toggle-icon-color-split'), limits.toggle), 0),
        ...iconRules(`${PREVIEW} .pref-preview-popup > span`, computeTrayIconStyle(settings, {light: editsLight('overflow-container-color-split'), limits: limits.popup})),
        boxRules(`${PREVIEW} .pref-preview-popup`, computeOverflowStyle(settings, editsLight('overflow-container-color-split')), 0),
    ];
}

function iconRules(selector, {enableCustom, baseStyle, hoverStyle}) {
    const blur = enableCustom ? blurCss(settings.get_int('icon-blur')) : '';
    const size = enableCustom ? AUTO_SIZE : '';
    return [styleRules(selector, baseStyle && `${baseStyle}${size}${blur}`, hoverStyle)];
}

function toggleRules(selector, {baseStyle, hoverStyle, iconColor, iconHoverColor}, blur) {
    if (!baseStyle)
        return [];
    return [styleRules(selector, `${baseStyle} color: ${iconColor};${AUTO_SIZE}${blurCss(blur)}`, `${hoverStyle} color: ${iconHoverColor};`)];
}

function boxRules(selector, baseStyle, blur) {
    return baseStyle ? styleRules(selector, `${baseStyle}${blurCss(blur)}`) : '';
}
