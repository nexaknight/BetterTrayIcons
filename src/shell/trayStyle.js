import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {usesAccent} from '../shared/accentColor.js';
import {SPLIT_COLOR_KEYS, colorKeyFor} from '../shared/colorVariant.js';
import {boxGeometryCss, borderShorthand} from '../shared/boxStyle.js';

const FALLBACK_ICON_COLOR = '#ffffff';

export const ST_ACCENT_COLOR = '-st-accent-color';

// Settings writes 'default' for Light, so only PREFER_DARK means dark.
export function sessionUsesLightStyle() {
    return St.Settings.get().color_scheme !== St.SystemColorScheme.PREFER_DARK;
}

function panelUsesLightStyle() {
    return Main.getStyleVariant() === 'light';
}

export function popupUsesLightStyle(settings) {
    return settings.get_boolean('enable-custom-overflow-style')
        ? sessionUsesLightStyle()
        : panelUsesLightStyle();
}

export function surfaceUsesLightStyle(actor, settings) {
    return Main.panel.contains(actor) ? panelUsesLightStyle() : popupUsesLightStyle(settings);
}

// These flip which set a surface reads without any color itself changing.
export function connectColorSetChanges(settings, run) {
    const settingsIds = ['enable-custom-overflow-style', ...SPLIT_COLOR_KEYS]
        .map(key => settings.connect(`changed::${key}`, run));
    const stId = St.Settings.get().connect('notify::color-scheme', run);
    return {
        disconnect() {
            settingsIds.forEach(id => settings.disconnect(id));
            St.Settings.get().disconnect(stId);
        },
    };
}

export function refreshTrayStyle(actor, iconActor, settings) {
    iconActor.set_icon_size(settings.get_int('icon-size'));

    const {enableCustom, baseStyle, hoverStyle} = computeTrayIconStyle(settings,
        {light: surfaceUsesLightStyle(actor, settings)});
    applyPanelClasses(actor, iconActor, enableCustom);

    actor._baseStyle = baseStyle;
    actor._hoverStyle = hoverStyle;
    syncHoverStyle(actor);
}

// XEmbed icons are opaque X11 pixmaps, so `withColors: false` skips the
// foreground color rules for them.
export function computeTrayIconStyle(settings, {withColors = true, light = false} = {}) {
    const enableCustom = settings.get_boolean('enable-custom-icon-style');

    let baseStyle = '';
    let hoverStyle = '';
    if (enableCustom) {
        const bg = resolveColor(settings, 'icon-background-color', light);
        const color = withColors ? ` color: ${resolveColor(settings, 'icon-color', light)};` : '';
        baseStyle = `${boxGeometryCss(settings, {spacingPrefix: 'icon'})}${color}` +
            ` background-color: ${bg}; border: ${_borderShorthand(settings, 'icon', light)}; box-shadow: none;`;

        const hoverBg = resolveColor(settings, 'icon-hover-background-color', light);
        hoverStyle = `${baseStyle} background-color: ${hoverBg};`;
        const hoverColor = withColors ? resolveColor(settings, 'icon-hover-color', light) : null;
        if (hoverColor)
            hoverStyle += ` color: ${hoverColor};`;
        hoverStyle += _hoverBorderCss(settings, 'icon', light);
    }

    return {enableCustom, baseStyle, hoverStyle};
}

export function applyPanelClasses(actor, iconActor, enableCustom) {
    const apply = (target, styleClass) => {
        if (!target)
            return;
        if (enableCustom)
            target.remove_style_class_name(styleClass);
        else
            target.add_style_class_name(styleClass);
    };
    apply(actor, 'panel-button');
    apply(iconActor, 'system-status-icon');
}

export function syncHoverStyle(actor) {
    actor.set_style(actor.hover ? actor._hoverStyle : actor._baseStyle);
}

export function computeToggleStyle(settings) {
    const isCustomToggleStyleOn = settings.get_boolean('enable-custom-toggle-style');
    const shouldInheritIcons = isCustomToggleStyleOn &&
        settings.get_boolean('toggle-inherit-icon-style') &&
        settings.get_boolean('enable-custom-icon-style');

    const light = panelUsesLightStyle();

    if (shouldInheritIcons) {
        const inheritedColor = resolveColor(settings, 'icon-color', light) || FALLBACK_ICON_COLOR;
        return {
            baseStyle: computeTrayIconStyle(settings, {light}).baseStyle,
            hoverStyle: `background-color: ${resolveColor(settings, 'icon-hover-background-color', light)};${
                _hoverBorderCss(settings, 'icon', light)}`,
            iconColor: inheritedColor,
            iconHoverColor: resolveColor(settings, 'icon-hover-color', light) || inheritedColor,
        };
    }

    if (isCustomToggleStyleOn) {
        const baseColor = resolveColor(settings, 'toggle-icon-color', light) || FALLBACK_ICON_COLOR;
        return {
            baseStyle: generateBoxStyle(settings, 'toggle', {
                radiusPrefix: 'toggle-icon',
                colorPrefix: 'toggle-icon',
                extraCss: ' box-shadow: none;',
                light,
            }),
            hoverStyle: `background-color: ${resolveColor(settings, 'toggle-icon-hover-background-color', light)};${
                _hoverBorderCss(settings, 'toggle-icon', light)}`,
            iconColor: baseColor,
            iconHoverColor: resolveColor(settings, 'toggle-icon-hover-color', light) || baseColor,
        };
    }

    return {baseStyle: '', hoverStyle: '', iconColor: '', iconHoverColor: ''};
}

export function generateBoxStyle(settings, prefix, options = {}) {
    const extraCss = options.extraCss || '';
    const radiusPrefix = options.radiusPrefix || prefix;
    const colorPrefix = options.colorPrefix || prefix;
    const light = options.light === true;
    const minMargin = options.minMargin || {};

    let css = boxGeometryCss(settings, {spacingPrefix: prefix, radiusPrefix, minMargin});

    const schema = settings.settings_schema;
    const bgKey = `${colorPrefix}-background-color`;
    if (schema.has_key(bgKey)) {
        const bg = resolveColor(settings, bgKey, light);
        if (bg)
            css += ` background-color: ${bg};`;
    }
    const fgKey = `${colorPrefix}-color`;
    if (schema.has_key(fgKey)) {
        const color = resolveColor(settings, fgKey, light);
        if (color)
            css += ` color: ${color};`;
    }
    css += ` border: ${_borderShorthand(settings, colorPrefix, light)};`;

    if (extraCss)
        css += extraCss;

    return css;
}

function _hoverBorderCss(settings, prefix, light) {
    const color = resolveColor(settings, `${prefix}-hover-border-color`, light);
    return color ? ` border-color: ${color};` : '';
}

function _borderShorthand(settings, prefix, light) {
    return borderShorthand(settings, prefix, key => resolveColor(settings, key, light));
}

// Handing St the keyword instead of a resolved value lets it track the system
// accent itself, so nothing has to re-apply the style when the accent changes.
function resolveColor(settings, colorKey, light) {
    const value = settings.get_string(colorKeyFor(settings, colorKey, light));
    return usesAccent(value) ? ST_ACCENT_COLOR : value;
}
