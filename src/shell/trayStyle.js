import Cogl from 'gi://Cogl';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DEFAULT_PILL_RADIUS_PX, DEFAULT_ICON_PADDING_PX, ICON_MARGIN_PX} from '../const.js';
import {usesAccent} from '../shared/accentColor.js';
import {SPLIT_COLOR_KEYS, colorKeyFor, withLightTwins} from '../shared/colorVariant.js';
import {boxGeometryCss, borderShorthand} from '../shared/boxStyle.js';
import {THEME_FOREGROUND, THEME_HOVER_BACKGROUND, backgroundIsLight} from '../shared/colorContrast.js';

const FALLBACK_ICON_COLOR = '#ffffff';

// The theme's stock rules only match under #panel, so popup icons carry the
// stock look inline. In the panel an inline style would override the theme's
// own hover and active rules.
const STOCK_POPUP_ICON_STYLE = `padding: ${DEFAULT_ICON_PADDING_PX}px; margin: 0px ${ICON_MARGIN_PX}px; ` +
    `border-radius: ${DEFAULT_PILL_RADIUS_PX}px; border: 0px; box-shadow: none;`;

const COGL_CHANNEL_MAX = 255;

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

// The popup background is in here because stock popup icons contrast with it.
export function connectColorSetChanges(settings, run) {
    const keys = [
        'enable-custom-overflow-style',
        ...SPLIT_COLOR_KEYS,
        ...withLightTwins(['overflow-container-background-color']),
    ];
    const settingsIds = keys.map(key => settings.connect(`changed::${key}`, run));
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

    const {enableCustom, baseStyle, hoverStyle} = trayIconStyleFor(actor, settings);
    applyPanelClasses(actor, iconActor, enableCustom);

    actor._baseStyle = baseStyle;
    actor._hoverStyle = hoverStyle;
    syncHoverStyle(actor);
}

export function trayIconStyleFor(actor, settings, {withColors = true} = {}) {
    const inPanel = Main.panel.contains(actor);
    return computeTrayIconStyle(settings, {
        withColors,
        light: inPanel ? panelUsesLightStyle() : popupUsesLightStyle(settings),
        inPanel,
    });
}

export function computeTrayIconStyle(settings, {withColors = true, light = false, inPanel = false} = {}) {
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
    } else if (!inPanel) {
        const customPopupIsLight = _customPopupIsLight(settings, light);
        const onLight = customPopupIsLight ?? light;
        baseStyle = STOCK_POPUP_ICON_STYLE;
        if (withColors && customPopupIsLight !== null)
            baseStyle += ` color: ${onLight ? THEME_FOREGROUND.onLight : THEME_FOREGROUND.onDark};`;
        hoverStyle = `${baseStyle} background-color: ${
            onLight ? THEME_HOVER_BACKGROUND.onLight : THEME_HOVER_BACKGROUND.onDark};`;
    }

    return {enableCustom, baseStyle, hoverStyle};
}

// A custom popup paints its own background, so the theme's popup text color
// no longer contrasts with it. Null leaves a stock popup, and a translucent
// custom one, to the theme.
function _customPopupIsLight(settings, light) {
    if (!settings.get_boolean('enable-custom-overflow-style'))
        return null;
    const background = resolveColor(settings, 'overflow-container-background-color', light);
    if (background === ST_ACCENT_COLOR)
        return false;
    const [parsed, color] = Cogl.Color.from_string(background);
    if (!parsed)
        return null;
    return backgroundIsLight({
        red: color.red / COGL_CHANNEL_MAX,
        green: color.green / COGL_CHANNEL_MAX,
        blue: color.blue / COGL_CHANNEL_MAX,
        alpha: color.alpha / COGL_CHANNEL_MAX,
    });
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
