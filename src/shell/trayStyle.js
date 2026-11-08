import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DEFAULT_PILL_RADIUS_PX, DEFAULT_ICON_PADDING_PX, ICON_MARGIN_PX} from '../const.js';
import {usesAccent} from '../shared/accentColor.js';
import {SPLIT_COLOR_KEYS, colorKeyFor, withLightTwins} from '../shared/colorVariant.js';
import {boxGeometryCss, borderShorthand} from '../shared/boxStyle.js';
import {THEME_FOREGROUND, THEME_HOVER_BACKGROUND, backgroundIsLight} from '../shared/colorContrast.js';
import {isInAnyPanel} from './panelCopies.js';

const FALLBACK_ICON_COLOR = '#ffffff';

// The theme's stock rules only match under #panel, so popup icons carry the
// stock look inline. In the panel an inline style would override the theme's
// own hover and active rules.
const STOCK_POPUP_ICON_STYLE = `padding: ${DEFAULT_ICON_PADDING_PX}px; margin: 0px ${ICON_MARGIN_PX}px; ` +
    `border-radius: ${DEFAULT_PILL_RADIUS_PX}px; border: 0px; box-shadow: none;`;

const COGL_CHANNEL_MAX = 255;

const BLUR_EFFECT_NAME = 'bettertrayicons-background-blur';

// The blur keys run 0 to 100. The top end is Blur my Shell's default of
// sigma 30, which the shell's radius counts twice.
const BLUR_STRENGTH_MAX = 100;
const BLUR_RADIUS_MAX_PX = 60;

export const ST_ACCENT_COLOR = '-st-accent-color';

// Settings writes 'default' for Light, so only PREFER_DARK means dark.
export function sessionUsesLightStyle() {
    return St.Settings.get().color_scheme !== St.SystemColorScheme.PREFER_DARK;
}

// 51 has its own reduced motion switch, 49 and 50 do not know the enum.
export function motionAllowed() {
    return St.ReducedMotion === undefined ||
        St.Settings.get().reducedMotion !== St.ReducedMotion.REDUCE;
}

export function shellUsesLightStyle() {
    return Main.getStyleVariant() === 'light';
}

export function popupUsesLightStyle(settings) {
    return settings.get_boolean('enable-custom-overflow-style')
        ? sessionUsesLightStyle()
        : shellUsesLightStyle();
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
    if (iconActor) {
        const size = settings.get_int('icon-size');
        iconActor.icon_size = size;
        // St reads an icon_size of 0 as the theme size, so a 0 px icon hides.
        iconActor.visible = size > 0;
    }

    const {enableCustom, baseStyle, hoverStyle} = trayIconStyleFor(actor, settings);
    applyIconChrome(actor, iconActor, settings, enableCustom);

    actor._baseStyle = baseStyle;
    actor._hoverStyle = hoverStyle;
    syncHoverStyle(actor);
}

// A Background Apps row lends its icon slot through _trayRowSlot. The row
// draws its own surface, so there the icon keeps the stock look, takes only
// the custom tint, and the blur sits behind the slot.
export function applyIconChrome(actor, iconActor, settings, enableCustom) {
    const rowSlot = actor._trayRowSlot;
    applyPanelClasses(actor, iconActor, enableCustom && !rowSlot);
    const blur = enableCustom ? settings.get_int('icon-blur') : 0;
    syncBackgroundBlur(actor, rowSlot ? 0 : blur);
    if (rowSlot)
        syncBackgroundBlur(rowSlot, blur);
}

export function trayIconStyleFor(actor, settings, {withColors = true} = {}) {
    if (actor._trayRowSlot)
        return computeRowIconStyle(settings, {withColors});
    const inPanel = isInAnyPanel(actor);
    return computeTrayIconStyle(settings, {
        withColors,
        light: inPanel ? shellUsesLightStyle() : popupUsesLightStyle(settings),
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

function computeRowIconStyle(settings, {withColors}) {
    const enableCustom = settings.get_boolean('enable-custom-icon-style');
    const color = enableCustom && withColors ? resolveColor(settings, 'icon-color', shellUsesLightStyle()) : '';
    const baseStyle = color ? `${STOCK_POPUP_ICON_STYLE} color: ${color};` : STOCK_POPUP_ICON_STYLE;
    return {enableCustom, baseStyle, hoverStyle: baseStyle};
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

// Blurs what lies behind the actor's box. Zero takes the effect off, so a
// surface without blur paints exactly as before.
export function syncBackgroundBlur(actor, strength) {
    const effect = actor.get_effect(BLUR_EFFECT_NAME);
    if (strength <= 0) {
        if (effect)
            actor.remove_effect(effect);
        return;
    }
    const radius = Math.round(Math.min(strength, BLUR_STRENGTH_MAX) / BLUR_STRENGTH_MAX * BLUR_RADIUS_MAX_PX);
    if (effect) {
        effect.radius = radius;
        return;
    }
    actor.add_effect_with_name(BLUR_EFFECT_NAME,
        new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND, radius, brightness: 1}));
}

// A background blur only sees what its offscreen ancestor painted, and the
// shell renders the panel and every popup offscreen. Blurring through them
// needs them on screen except while they fade.
export function letBlurSeeThrough(ancestor, isBlurred) {
    ancestor._bettertrayiconsRedirect ??= ancestor.offscreen_redirect;
    ancestor.offscreen_redirect = isBlurred
        ? Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY
        : ancestor._bettertrayiconsRedirect;
    if (!isBlurred)
        delete ancestor._bettertrayiconsRedirect;
}

export function panelBlurWanted(settings) {
    return (settings.get_boolean('enable-custom-icon-style') && settings.get_int('icon-blur') > 0) ||
        (settings.get_boolean('enable-custom-toggle-style') && settings.get_int('toggle-blur') > 0);
}

export function syncHoverStyle(actor) {
    actor.set_style(actor.hover ? actor._hoverStyle : actor._baseStyle);
}

export function computeToggleStyle(settings) {
    const isCustomToggleStyleOn = settings.get_boolean('enable-custom-toggle-style');
    const shouldInheritIcons = isCustomToggleStyleOn &&
        settings.get_boolean('toggle-inherit-icon-style') &&
        settings.get_boolean('enable-custom-icon-style');

    const light = shellUsesLightStyle();

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
    const bg = resolveColor(settings, `${colorPrefix}-background-color`, light);
    if (bg)
        css += ` background-color: ${bg};`;
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
