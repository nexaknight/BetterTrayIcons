import {BOX_SIDES} from '../../../src/shared/boxStyle.js';

// The style keys of the GSettings schema with their defaults, under their
// schema names so src/shell/trayStyle.js ports over unchanged
const COLOR_DEFAULTS = {
    'icon-color': '#ffffff',
    'icon-hover-color': '#ffffff',
    'icon-background-color': 'rgba(0,0,0,0)',
    'icon-hover-background-color': 'rgba(255, 255, 255, 0.1)',
    'icon-border-color': '#ffffff',
    'icon-hover-border-color': '#ffffff',
    'icon-color-light': '#222226',
    'icon-hover-color-light': '#222226',
    'icon-background-color-light': 'rgba(0,0,0,0)',
    'icon-hover-background-color-light': 'rgba(0, 0, 0, 0.1)',
    'icon-border-color-light': '#222226',
    'icon-hover-border-color-light': '#222226',
    'toggle-icon-color': '#ffffff',
    'toggle-icon-hover-color': '#ffffff',
    'toggle-icon-background-color': 'rgba(0,0,0,0)',
    'toggle-icon-hover-background-color': 'rgba(255, 255, 255, 0.1)',
    'toggle-icon-border-color': '#ffffff',
    'toggle-icon-hover-border-color': '#ffffff',
    'toggle-icon-color-light': '#222226',
    'toggle-icon-hover-color-light': '#222226',
    'toggle-icon-background-color-light': 'rgba(0,0,0,0)',
    'toggle-icon-hover-background-color-light': 'rgba(0, 0, 0, 0.1)',
    'toggle-icon-border-color-light': '#222226',
    'toggle-icon-hover-border-color-light': '#222226',
    'overflow-container-background-color': '#36363A',
    'overflow-container-border-color': '#ffffff',
    'overflow-container-background-color-light': '#fafafb',
    'overflow-container-border-color-light': '#e6e6eb',
};

const spacing = (prefix, padding) => Object.fromEntries(BOX_SIDES.flatMap(side =>
    [[`${prefix}-padding-${side}`, padding], [`${prefix}-margin-${side}`, 0]])
    .concat([[`${prefix}-padding-linked`, false], [`${prefix}-margin-linked`, false]]));

export const STYLE_DEFAULTS = {
    'enable-custom-icon-style': false,
    'enable-custom-toggle-style': false,
    'enable-custom-overflow-style': false,
    'color-variant-editing': 'dark',
    'icon-color-split': true,
    'toggle-icon-color-split': true,
    'overflow-container-color-split': true,
    'toggle-inherit-icon-style': false,
    'icon-border-radius': 50,
    'icon-border-width': 0,
    'icon-blur': 0,
    'toggle-icon-border-radius': 50,
    'toggle-icon-border-width': 0,
    'toggle-blur': 0,
    'overflow-container-border-radius': 25,
    'overflow-container-border-width': 0,
    'overflow-container-blur': 0,
    ...spacing('icon', 5),
    ...spacing('toggle', 0),
    ...spacing('overflow-container', 5),
    ...COLOR_DEFAULTS,
};

export const STYLE_KINDS = {
    icons: {customKey: 'enable-custom-icon-style', colorPrefix: 'icon', spacingPrefix: 'icon', blurKey: 'icon-blur'},
    toggle: {customKey: 'enable-custom-toggle-style', colorPrefix: 'toggle-icon', spacingPrefix: 'toggle', blurKey: 'toggle-blur'},
    overflow: {customKey: 'enable-custom-overflow-style', colorPrefix: 'overflow-container', spacingPrefix: 'overflow-container', blurKey: 'overflow-container-blur'},
};

export function styleKeysOf(kind) {
    const {customKey, colorPrefix, spacingPrefix, blurKey} = STYLE_KINDS[kind];
    const owns = key => key.startsWith(`${colorPrefix}-`) || key.startsWith(`${spacingPrefix}-`);
    const keys = Object.keys(STYLE_DEFAULTS).filter(owns);
    const inherit = kind === 'toggle' ? ['toggle-inherit-icon-style'] : [];
    return [...new Set([customKey, blurKey, ...inherit, ...keys])];
}
