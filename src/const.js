// Only two kinds of values belong here. Ones both processes need with no
// shared module to own them, and ones outside contributors edit.
// Everything else sits at the top of the module that uses it.

export const ITEM_SPACING_PX = 6;

export const ICON_MARGIN_PX = 1;

export const DEFAULT_ICON_PADDING_PX = 5;

export const DEFAULT_PILL_RADIUS_PX = 50;

// Touch has no buttons, so it binds under its own name next to left/middle/right.
export const TOUCH_BINDING = 'tap';

export const BOX_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);

// The shell restyles tray icons on these, the prefs reset and preview them.
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
    'icon-color',
    'icon-hover-color',
    'icon-background-color',
    'icon-hover-background-color',
    'icon-border-color',
    'icon-hover-border-color',
]);

// The badge_style vocabulary the shell renders and the prefs dialog writes.
// The first position is the default, and each name encodes its corner as
// vertical-horizontal, which is what the shell derives its alignment from.
export const BADGE_POSITIONS = Object.freeze(['bottom-right', 'bottom-left', 'top-right', 'top-left']);
// GNOME's destructive red, so the badge reads as an alert in any theme.
export const BADGE_DEFAULT_COLOR = '#e01b24';
export const BADGE_DEFAULT_TEXT_COLOR = '#ffffff';

// Conceptually these belong to the live-preview system in prefs/widgets/
// preview.js, which is their only real reader. They sit here instead because
// gtkHelpers.js also needs PREVIEW_STOCK_POPUP_CSS (for the static layout
// thumbnails' matching backdrop) and importing it from preview.js would
// create an import cycle between the two.
export const PREVIEW_ELEMENT_SHADOW_CSS = 'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);';
export const PREVIEW_STOCK_POPUP_CSS =
    `background-color: rgba(48, 48, 48, 1); border-radius: 14px; padding: 8px; ${PREVIEW_ELEMENT_SHADOW_CSS}`;

// See CONTRIBUTING.md and the wiki for the opt-out procedure.
export const CONTRIBUTORS_OPTOUT = new Set([
    'github-actions[bot]',
    'dependabot[bot]',
    'Agent19872',
].map(name => name.toLowerCase()));
