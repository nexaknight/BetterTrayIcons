import {parseColor} from './color.js';
import {usesAccent} from '../../../src/shared/accentColor.js';
import {BOX_SIDES, borderShorthand, boxGeometryCss as unclampedGeometryCss} from '../../../src/shared/boxStyle.js';
import {colorKeyFor} from '../../../src/shared/colorVariant.js';

// A port of src/shell/trayStyle.js. The shell feeds these strings to St, the
// page feeds the same strings to CSS rules, so the demo preview and the
// landing tray paint from one builder.
const FALLBACK_ICON_COLOR = '#ffffff';
// The shell hands St its accent keyword, the page has its own hero blue
const PAGE_ACCENT_COLOR = 'var(--accent)';
// CONTAINER_SIDE_MARGIN_MIN_PX in src/shell/components/overflowMenu.js
const CONTAINER_SIDE_MARGIN_MIN_PX = 1;
// THEME_FOREGROUND and backgroundIsLight in src/shared/colorContrast.js
const THEME_FOREGROUND = {onLight: '#222226', onDark: '#ffffff'};
const OPAQUE_ALPHA_MIN = 0.5;
const LIGHT_LUMA_MIN = 0.6;
const SHORT_HEX = /^#([\da-f]{3,4})$/i;
// The blur keys run 0 to 100, the shell's radius 0 to 60 counts sigma twice
const BLUR_STRENGTH_MAX = 100;
const BLUR_RADIUS_MAX_PX = 60;

// The page has no session scheme of its own, the color set the demo edits
// stands in for it
export function popupUsesLightStyle(settings, sessionIsLight) {
    return settings.get_boolean('enable-custom-overflow-style') && sessionIsLight;
}

export function computeTrayIconStyle(settings, {light = false, inPanel = false, limits = null} = {}) {
    const enableCustom = settings.get_boolean('enable-custom-icon-style');
    if (!enableCustom) {
        // The page's own stylesheet draws the stock icon, only the color a
        // custom popup background needs comes from here
        const customPopupIsLight = inPanel ? null : _customPopupIsLight(settings, light);
        const foreground = customPopupIsLight ? THEME_FOREGROUND.onLight : THEME_FOREGROUND.onDark;
        const color = customPopupIsLight === null ? '' : ` color: ${foreground};`;
        return {enableCustom, baseStyle: color, hoverStyle: color};
    }
    const background = resolveColor(settings, 'icon-background-color', light);
    const baseStyle = `${boxGeometryCss(settings, {spacingPrefix: 'icon', limits})} color: ${resolveColor(settings, 'icon-color', light)};` +
        ` background-color: ${background}; border: ${_borderShorthand(settings, 'icon', light)}; box-shadow: none;`;
    let hoverStyle = `${baseStyle} background-color: ${resolveColor(settings, 'icon-hover-background-color', light)};`;
    const hoverColor = resolveColor(settings, 'icon-hover-color', light);
    if (hoverColor)
        hoverStyle += ` color: ${hoverColor};`;
    hoverStyle += _hoverBorderCss(settings, 'icon', light);
    return {enableCustom, baseStyle, hoverStyle};
}

// A custom popup paints its own background, so the stock icon color no
// longer contrasts with it. Null leaves a stock or translucent popup alone.
function _customPopupIsLight(settings, light) {
    if (!settings.get_boolean('enable-custom-overflow-style'))
        return null;
    const background = resolveColor(settings, 'overflow-container-background-color', light);
    if (background === PAGE_ACCENT_COLOR)
        return false;
    const rgba = parseColor(fullHex(background));
    if (!rgba || rgba.alpha < OPAQUE_ALPHA_MIN)
        return null;
    return 0.299 * rgba.red + 0.587 * rgba.green + 0.114 * rgba.blue >= LIGHT_LUMA_MIN;
}

// The color picker's palette writes #fff, the short form parseColor skips
function fullHex(value) {
    const digits = value.match(SHORT_HEX)?.[1];
    return digits ? `#${[...digits].map(digit => digit + digit).join('')}` : value;
}

export function computeToggleStyle(settings, light = false, limits = null) {
    const isCustomToggleStyleOn = settings.get_boolean('enable-custom-toggle-style');
    const shouldInheritIcons = isCustomToggleStyleOn &&
        settings.get_boolean('toggle-inherit-icon-style') &&
        settings.get_boolean('enable-custom-icon-style');

    if (shouldInheritIcons) {
        const inheritedColor = resolveColor(settings, 'icon-color', light) || FALLBACK_ICON_COLOR;
        return {
            baseStyle: computeTrayIconStyle(settings, {light, limits}).baseStyle,
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
                limits,
            }),
            hoverStyle: `background-color: ${resolveColor(settings, 'toggle-icon-hover-background-color', light)};${
                _hoverBorderCss(settings, 'toggle-icon', light)}`,
            iconColor: baseColor,
            iconHoverColor: resolveColor(settings, 'toggle-icon-hover-color', light) || baseColor,
        };
    }

    return {baseStyle: '', hoverStyle: '', iconColor: '', iconHoverColor: ''};
}

// applyStyle in src/shell/components/overflowMenu.js
export function computeOverflowStyle(settings, light) {
    if (!settings.get_boolean('enable-custom-overflow-style'))
        return '';
    return generateBoxStyle(settings, 'overflow-container', {
        minMargin: {left: CONTAINER_SIDE_MARGIN_MIN_PX, right: CONTAINER_SIDE_MARGIN_MIN_PX},
        light,
    });
}

// syncBackgroundBlur, a CSS blur takes the sigma the shell's radius doubles
export function blurCss(strength) {
    if (strength <= 0)
        return '';
    const radius = Math.round(Math.min(strength, BLUR_STRENGTH_MAX) / BLUR_STRENGTH_MAX * BLUR_RADIUS_MAX_PX);
    return ` -webkit-backdrop-filter: blur(${radius / 2}px); backdrop-filter: blur(${radius / 2}px);`;
}

export function styleRules(selector, baseStyle, hoverStyle = '') {
    const hover = hoverStyle ? `${selector}:hover { ${hoverStyle} }` : '';
    return baseStyle ? `${selector} { ${baseStyle} }${hover}` : hover;
}

function generateBoxStyle(settings, prefix, options = {}) {
    const extraCss = options.extraCss || '';
    const radiusPrefix = options.radiusPrefix || prefix;
    const colorPrefix = options.colorPrefix || prefix;
    const light = options.light === true;
    const minMargin = options.minMargin || {};

    let css = boxGeometryCss(settings, {spacingPrefix: prefix, radiusPrefix, minMargin, limits: options.limits ?? null});

    const background = resolveColor(settings, `${colorPrefix}-background-color`, light);
    if (background)
        css += ` background-color: ${background};`;
    const foregroundKey = `${colorPrefix}-color`;
    if (settings.settings_schema.has_key(foregroundKey)) {
        const color = resolveColor(settings, foregroundKey, light);
        if (color)
            css += ` color: ${color};`;
    }
    css += ` border: ${_borderShorthand(settings, colorPrefix, light)};`;
    return css + extraCss;
}

function boxGeometryCss(settings, {limits = null, ...geometry}) {
    if (!limits)
        return unclampedGeometryCss(settings, geometry);
    const {spacingPrefix, radiusPrefix = spacingPrefix} = geometry;
    const radius = ` border-radius: ${settings.get_int(`${radiusPrefix}-border-radius`)}px;`;
    const read = type => Object.fromEntries(BOX_SIDES.map(side => [side, settings.get_int(`${spacingPrefix}-${type}-${side}`)]));
    const {padding, margin} = clampedSpacing(read('padding'), read('margin'), limits);
    const shorthand = sides => BOX_SIDES.map(side => `${sides[side]}px`).join(' ');
    return `padding: ${shorthand(padding)}; margin: ${shorthand(margin)};${radius}`;
}

// The shell's top bar never grows, its items get clipped instead. The page
// keeps them whole. Vertical padding and margin share what the bar leaves
// around the icon, each pair in its own proportion, and the side margins
// stop where the tray would reach the clock. The settings keep their value,
// only the drawing stops.
function clampedSpacing(padding, margin, {blockSize = Infinity, content = 0, inlineMargin = Infinity}) {
    const fit = (sides, budget) => {
        const total = sides.top + sides.bottom;
        if (total <= budget)
            return sides;
        const scale = Math.max(0, budget) / total;
        return {...sides, top: Math.floor(sides.top * scale), bottom: Math.floor(sides.bottom * scale)};
    };
    const fittedPadding = fit(padding, blockSize - content);
    const fittedMargin = fit(margin, blockSize - content - fittedPadding.top - fittedPadding.bottom);
    const cap = side => Math.min(fittedMargin[side], Math.max(0, Math.floor(inlineMargin)));
    return {padding: fittedPadding, margin: {...fittedMargin, left: cap('left'), right: cap('right')}};
}

function _hoverBorderCss(settings, prefix, light) {
    const color = resolveColor(settings, `${prefix}-hover-border-color`, light);
    return color ? ` border-color: ${color};` : '';
}

function _borderShorthand(settings, prefix, light) {
    return borderShorthand(settings, prefix, key => resolveColor(settings, key, light));
}

function resolveColor(settings, colorKey, light) {
    const value = settings.get_string(colorKeyFor(settings, colorKey, light));
    return usesAccent(value) ? PAGE_ACCENT_COLOR : value;
}
