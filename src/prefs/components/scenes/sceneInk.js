import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';

import {usesAccent} from '../../../shared/accentColor.js';
import {boxGeometryCss, borderShorthand} from '../../../shared/boxStyle.js';
import {THEME_FOREGROUND} from '../../../shared/colorContrast.js';
import {
    DEFAULT_PILL_RADIUS_PX, DEFAULT_ICON_PADDING_PX, ICON_MARGIN_PX,
} from '../../../const.js';
import {editedColorKey, editsLightSet} from '../color.js';

export const PREVIEW_SAMPLE_ICONS = Object.freeze([
    'bti-sample-chat-symbolic',
    'bti-sample-music-symbolic',
    'bti-sample-game-symbolic',
    'bti-sample-mail-symbolic',
    'bti-sample-camera-symbolic',
    'bti-sample-browser-symbolic',
    'bti-sample-vault-symbolic',
    'bti-sample-terminal-symbolic',
]);

// The stock popup in stylesheet.css wears the same shadow, keep the two in step.
const PREVIEW_ELEMENT_SHADOW_CSS = 'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);';

export function createSampleIcon(iconName, size, scopeClass) {
    return new Gtk.Image({icon_name: iconName, pixel_size: size, css_classes: [`${scopeClass}-icon`]});
}

// The box math is shared with the shell through boxStyle.js. Only the color
// lookup differs, St resolves its own accent keyword and GTK cannot.
export function trayIconCss(settings, scopeClass, {hover = false, stockForeground: stock = null} = {}) {
    if (!settings.get_boolean('enable-custom-icon-style')) {
        const color = stock ?? stockForeground(settings, 'icon-color-split');
        return `.${scopeClass}-icon { ${stockIconStyle(color)} margin: 0 ${ICON_MARGIN_PX}px; }`;
    }
    const base = `.${scopeClass}-icon { ${customIconStyle(settings)} }`;
    return hover
        ? `${base} .${scopeClass}-icon:hover { ${hoverStyle(settings, 'icon')} }`
        : base;
}

export function customIconStyle(settings) {
    const color = resolveColor(settings, 'icon-color');
    const bg = resolveColor(settings, 'icon-background-color');
    return `${boxGeometryCss(settings, {spacingPrefix: 'icon'})}` +
        `${cssDeclaration('color', color || THEME_FOREGROUND.onDark)}${backgroundStyle(bg)}${borderStyle(settings, 'icon')}`;
}

// No shadow on hover, GTK draws an outset shadow under a pill with a seam
// and the shell's hover adds none either.
export function hoverStyle(settings, prefix) {
    const color = resolveColor(settings, `${prefix}-hover-color`);
    const bg = resolveColor(settings, `${prefix}-hover-background-color`);
    const border = resolveColor(settings, `${prefix}-hover-border-color`);
    return `${cssDeclaration('color', color)}${cssDeclaration('background-color', bg)}${cssDeclaration('border-color', border)}`;
}

export function stockIconStyle(color) {
    return `padding: ${DEFAULT_ICON_PADDING_PX}px; border-radius: ${DEFAULT_PILL_RADIUS_PX}px; color: ${color};`;
}

export function stockForeground(settings, splitKey) {
    return editsLightFor(settings, splitKey) ? THEME_FOREGROUND.onLight : THEME_FOREGROUND.onDark;
}

export function editsLightFor(settings, splitKey) {
    return settings.get_boolean(splitKey) && editsLightSet(settings);
}

export function backgroundStyle(bg) {
    const rgba = new Gdk.RGBA();
    const isVisible = !!bg && rgba.parse(bg) && rgba.alpha > 0;
    return cssDeclaration('background-color', bg) + (isVisible ? ` ${PREVIEW_ELEMENT_SHADOW_CSS}` : '');
}

export function borderStyle(settings, prefix) {
    const border = borderShorthand(settings, prefix, key => resolveColor(settings, key));
    return border === '0px' ? '' : ` border: ${border};`;
}

export function cssDeclaration(prop, value) {
    return value ? ` ${prop}: ${value};` : '';
}

export function resolveColor(settings, colorKey) {
    const value = settings.get_string(editedColorKey(settings, colorKey));
    return usesAccent(value)
        ? Adw.StyleManager.get_default().get_accent_color_rgba().to_string()
        : value;
}
