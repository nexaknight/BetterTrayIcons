// Only two kinds of values belong here. Ones both processes need with no
// shared module to own them, and ones outside contributors edit.
// Everything else sits at the top of the module that uses it.

import {withLightTwins} from './shared/colorVariant.js';

export const ITEM_SPACING_PX = 6;

export const ICON_MARGIN_PX = 1;

export const DEFAULT_ICON_PADDING_PX = 5;

export const DEFAULT_PILL_RADIUS_PX = 50;

// Touch has no buttons, so it binds under its own name next to left/middle/right.
export const TOUCH_BINDING = 'tap';

// The schema range carries no step, the spinners take all three from here
export const ICON_SIZE_RANGE_PX = Object.freeze({min: 0, max: 40, step: 1});

// The display-mode choices in the schema
export const DISPLAY_MODE = Object.freeze({
    POPUP: 'popup',
    DRAWER: 'drawer',
    BACKGROUND_APPS: 'background-apps',
});

export const BORDER_RADIUS_MAX_PX = 50;

export const BORDER_WIDTH_MAX_PX = 20;

const TRAY_COLOR_KEYS = Object.freeze([
    'icon-color',
    'icon-hover-color',
    'icon-background-color',
    'icon-hover-background-color',
    'icon-border-color',
    'icon-hover-border-color',
]);

export const TRAY_STYLE_KEYS = Object.freeze([
    'enable-custom-icon-style',
    'icon-size',
    'icon-padding-top',
    'icon-padding-bottom',
    'icon-padding-left',
    'icon-padding-right',
    'icon-margin-top',
    'icon-margin-bottom',
    'icon-margin-left',
    'icon-margin-right',
    'icon-border-radius',
    'icon-border-width',
    'icon-color-split',
    'icon-blur',
    ...withLightTwins(TRAY_COLOR_KEYS),
]);

// Values for badge_style.position. The first one is the default, and each name
// encodes its corner as vertical-horizontal, which is what the shell derives
// its alignment from.
export const BADGE_POSITIONS = Object.freeze(['bottom-right', 'bottom-left', 'top-right', 'top-left']);
// GNOME's destructive red, so the badge reads as an alert in any theme.
export const BADGE_DEFAULT_COLOR = '#e01b24';
export const BADGE_DEFAULT_TEXT_COLOR = '#ffffff';

// The donation services metadata.json may list, with the base URL and name
// extensions.gnome.org uses for each, so a row opens the same page EGO links.
// A service without a bundled icon gets the plain link glyph.
export const DONATION_SERVICES = Object.freeze({
    buymeacoffee: {name: 'Buy Me a Coffee', baseUrl: 'https://www.buymeacoffee.com', iconName: 'bti-buymeacoffee-symbolic'},
    github: {name: 'GitHub', baseUrl: 'https://github.com/sponsors', iconName: 'bti-github-symbolic'},
    kofi: {name: 'Ko-fi', baseUrl: 'https://ko-fi.com'},
    liberapay: {name: 'Liberapay', baseUrl: 'https://liberapay.com'},
    opencollective: {name: 'Open Collective', baseUrl: 'https://opencollective.com'},
    patreon: {name: 'Patreon', baseUrl: 'https://www.patreon.com'},
    paypal: {name: 'PayPal', baseUrl: 'https://paypal.me'},
});

// CONTRIBUTING.md has the opt-out procedure.
export const CONTRIBUTORS_OPTOUT = new Set([
    'github-actions[bot]',
    'dependabot[bot]',
].map(name => name.toLowerCase()));
