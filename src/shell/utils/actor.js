import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    DEFAULT_HOVER_BG_COLOR,
    DEFAULT_PILL_RADIUS_PX,
    ICON_MARGIN_PX,
    BOX_SIDES,
} from '../../const.js';

// GJS has no public predicate for disposed actors. The "(disposed)" marker
// in toString output is the workaround.
export function isDisposed(actor) {
    return !actor || actor.toString().includes('disposed');
}

export function generateBoxStyle(settings, prefix, options = {}) {
    const includeColors = options.includeColors !== false;
    const extraCss = options.extraCss || '';
    const radiusPrefix = options.radiusPrefix || prefix;
    const colorPrefix = options.colorPrefix || prefix;
    // minMargin enforces a per-side floor on the margin values. Used so the
    // overflow container keeps a 1px gutter even when the user sets margin: 0.
    const minMargin = options.minMargin || {};

    const radius = settings.get_int(`${radiusPrefix}border-radius`);

    const box = mapByKey(['padding', 'margin'], group =>
        mapByKey(BOX_SIDES, side => settings.get_int(`${prefix}${group}-${side}`)));

    const margin = mapByKey(BOX_SIDES, side =>
        Math.max(box.margin[side], minMargin[side] || 0));

    let css = `
        border-radius: ${radius}px;
        padding: ${box.padding.top}px ${box.padding.right}px ${box.padding.bottom}px ${box.padding.left}px;
        margin: ${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px;
    `;

    if (includeColors) {
        // colorPrefix is dynamic (toggle-/icon-/overflow-container-) and not
        // every prefix has both keys. overflow-container has only background.
        const schema = settings.settings_schema;
        const bgKey = `${colorPrefix}background-color`;
        if (schema.has_key(bgKey)) {
            const bg = settings.get_string(bgKey);
            if (bg)
                css += `background-color: ${bg};`;
        }
        const fgKey = `${colorPrefix}color`;
        if (schema.has_key(fgKey)) {
            const col = settings.get_string(fgKey);
            if (col)
                css += `color: ${col};`;
        }
    }

    if (extraCss)
        css += extraCss;

    return css;
}

// Build {key: valueFn(key)} from a list of keys.
function mapByKey(keys, valueFn) {
    return Object.fromEntries(keys.map(key => [key, valueFn(key)]));
}

export function placeIndicatorInPanel(indicator, settings) {
    if (!indicator)
        return;

    const currentParent = indicator.get_parent();
    if (currentParent)
        currentParent.remove_child(indicator);

    const position = settings.get_string('tray-position');
    const order = settings.get_int('tray-order');

    let targetBox = null;

    switch (position) {
    case 'left':
        targetBox = Main.panel._leftBox;
        break;
    case 'center':
        targetBox = Main.panel._centerBox;
        break;
    case 'right':
    default:
        targetBox = Main.panel._rightBox;
        break;
    }

    if (targetBox)
        targetBox.insert_child_at_index(indicator, order);
}

export function safelyReparentActor(actor, newParent) {
    if (!newParent || isDisposed(actor) || isDisposed(newParent))
        return;

    const oldParent = actor.get_parent();

    if (oldParent === newParent) {
        newParent.set_child_above_sibling(actor, null);
        return;
    }

    if (oldParent)
        oldParent.remove_child(actor);

    newParent.add_child(actor);
}

// Base and hover style pair shared by the SNI and XEmbed wrappers.
// XEmbed icons are opaque X11 pixmaps, so `withColors: false` skips
// the foreground color rules for them.
export function computeTrayIconStyle(settings, {withColors = true} = {}) {
    const enableCustom = settings.get_boolean('enable-custom-icon-style');
    const padV = settings.get_int('icon-padding-vertical');
    const padH = settings.get_int('icon-padding-horizontal');
    // Default mode keeps a 1px gap so neighbouring icons don't touch
    // the panel-button frames. Custom mode honours the user's value.
    const sideMargin = enableCustom ? 0 : ICON_MARGIN_PX;
    const layoutFixes = `margin: 0px ${sideMargin}px; border: 0px; box-shadow: none;`;

    let baseStyle;
    if (enableCustom) {
        const radius = settings.get_int('icon-border-radius');
        const bg = settings.get_string('icon-background-color');
        const color = withColors ? ` color: ${settings.get_string('icon-color')};` : '';
        baseStyle = `padding: ${padV}px ${padH}px; border-radius: ${radius}px;${color} background-color: ${bg}; ${layoutFixes}`;
    } else {
        baseStyle = `padding: ${padV}px ${padH}px; border-radius: ${DEFAULT_PILL_RADIUS_PX}px; ${layoutFixes}`;
    }

    const hoverBg = enableCustom
        ? settings.get_string('icon-hover-background-color')
        : DEFAULT_HOVER_BG_COLOR;
    let hoverStyle = `${baseStyle} background-color: ${hoverBg};`;
    if (enableCustom && withColors) {
        const hoverColor = settings.get_string('icon-hover-color');
        if (hoverColor)
            hoverStyle += ` color: ${hoverColor};`;
    }

    return {enableCustom, baseStyle, hoverStyle};
}

export function computeToggleStyle(settings) {
    // panel-button and system-status-icon ship a min-size, border and hover frame.
    // The caller strips both when custom styling takes over so a user-set 0
    // actually means 0.
    const customToggle = settings.get_boolean('enable-custom-toggle-style');
    const inheritIcons = customToggle && settings.get_boolean('toggle-inherit-icon-style');

    if (inheritIcons) {
        return {
            baseStyle: _buildInheritedToggleBase(settings),
            hoverStyle: _buildInheritedToggleHover(settings),
            iconColor: settings.get_string('icon-color') || '#ffffff',
            iconHoverColor: settings.get_string('icon-hover-color') ||
                settings.get_string('icon-color') || '#ffffff',
        };
    }

    if (customToggle) {
        const layoutFixes = 'border: 0; box-shadow: none;';
        const baseColor = settings.get_string('toggle-icon-color') || '#ffffff';
        return {
            baseStyle: generateBoxStyle(settings, 'toggle-', {
                radiusPrefix: 'toggle-icon-',
                colorPrefix: 'toggle-icon-',
                extraCss: layoutFixes,
            }),
            hoverStyle: `background-color: ${settings.get_string('toggle-icon-hover-background-color')};`,
            iconColor: baseColor,
            iconHoverColor: settings.get_string('toggle-icon-hover-color') || baseColor,
        };
    }

    return {baseStyle: '', hoverStyle: '', iconColor: '', iconHoverColor: ''};
}

function _buildInheritedToggleBase(settings) {
    if (!settings.get_boolean('enable-custom-icon-style'))
        return '';
    const padV = settings.get_int('icon-padding-vertical');
    const padH = settings.get_int('icon-padding-horizontal');
    const radius = settings.get_int('icon-border-radius');
    const color = settings.get_string('icon-color');
    const bg = settings.get_string('icon-background-color');
    return `padding: ${padV}px ${padH}px; border-radius: ${radius}px; color: ${color}; background-color: ${bg}; border: 0; box-shadow: none;`;
}

function _buildInheritedToggleHover(settings) {
    const enableCustomIcon = settings.get_boolean('enable-custom-icon-style');
    const bg = enableCustomIcon
        ? settings.get_string('icon-hover-background-color')
        : DEFAULT_HOVER_BG_COLOR;
    return `background-color: ${bg};`;
}
