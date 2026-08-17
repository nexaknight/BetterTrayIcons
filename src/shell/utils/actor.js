import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {DEFAULT_PILL_RADIUS_PX, DEFAULT_ICON_PADDING_PX, ICON_MARGIN_PX, BOX_SIDES, BADGE_POSITIONS, BADGE_DEFAULT_COLOR, BADGE_DEFAULT_TEXT_COLOR} from '../../const.js';

const DEFAULT_HOVER_BG_COLOR = 'rgba(255,255,255,0.1)';

const ST_ACCENT_COLOR = '-st-accent-color';

// Mirrors PopupAnimation.NONE.
export const POPUP_ANIMATION_NONE = 0;

// GJS logs a critical on every member access of a disposed GObject,
// toString included, and its string carries no disposed marker anymore.
// Probing is both noisy and blind, so track destruction ourselves.
const _destroyedActors = new WeakSet();
const _trackedActors = new WeakSet();

export function trackDisposal(actor) {
    if (actor && !_trackedActors.has(actor)) {
        _trackedActors.add(actor);
        actor.connect('destroy', () => _destroyedActors.add(actor));
    }
    return actor;
}

export function isDisposed(actor) {
    return !actor || _destroyedActors.has(actor);
}

// Throws once the actor is disposed, which happens mid-drag and mid-hit-test.
export function safeBounds(actor) {
    try {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        return [x, y, w, h];
    } catch {
        return null;
    }
}

export function stageScaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
}

export function generateBoxStyle(settings, prefix, options = {}) {
    const includeColors = options.includeColors !== false;
    const extraCss = options.extraCss || '';
    const radiusPrefix = options.radiusPrefix || prefix;
    const colorPrefix = options.colorPrefix || prefix;
    // Lets the overflow container keep a 1px gutter even when the user sets
    // margin: 0.
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
        // Not every prefix has both keys, overflow-container has only background.
        const schema = settings.settings_schema;
        const bgKey = `${colorPrefix}background-color`;
        if (schema.has_key(bgKey)) {
            const bg = accentAwareColor(settings, bgKey, `${colorPrefix}background-use-accent-color`);
            if (bg)
                css += `background-color: ${bg};`;
        }
        const fgKey = `${colorPrefix}color`;
        if (schema.has_key(fgKey)) {
            const col = accentAwareColor(settings, fgKey, `${colorPrefix}use-accent-color`);
            if (col)
                css += `color: ${col};`;
        }
        css += `border: ${_borderShorthand(settings, colorPrefix)};`;
    }

    if (extraCss)
        css += extraCss;

    return css;
}

function mapByKey(keys, valueFn) {
    return Object.fromEntries(keys.map(key => [key, valueFn(key)]));
}

// Returning the -st-accent-color keyword instead of a resolved value lets St
// track the user's system accent for us, so nothing has to re-apply the style
// when the accent changes.
function accentAwareColor(settings, colorKey, accentKey) {
    const schema = settings.settings_schema;
    if (schema.has_key(accentKey) && settings.get_boolean(accentKey))
        return ST_ACCENT_COLOR;
    return settings.get_string(colorKey);
}

export function createPanelMenu(sourceActor, configure = null) {
    const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.TOP);
    menu.actor.add_style_class_name('panel-menu');
    configure?.(menu);
    Main.layoutManager.uiGroup.add_child(menu.actor);
    menu.actor.hide();
    return menu;
}

// An icon inside the overflow popup must not anchor its own menu:
// intellihide panels like Dash to Panel then slide away mid-menu and take
// the menu with them. Anchoring to the shell's dummy cursor over the
// icon's screen rect is what fixes it, confirmed on a live session. Why
// the two anchors differ is not established (both hang off uiGroup), so
// don't simplify this back to the actor on the strength of that.
export function menuAnchorFor(actor) {
    if (Main.panel.contains(actor))
        return actor;

    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    Main.layoutManager.setDummyCursorGeometry(x, y, w, h);
    return Main.layoutManager.dummyCursor;
}

// The menu actor can already be C-disposed during shutdown.
export function destroyMenuSafely(menu) {
    if (!menu || isDisposed(menu.actor))
        return;

    // Without closing first, removeMenu leaves the manager pointing at this
    // menu and the next close pops a grab that is already gone.
    if (menu.isOpen)
        menu.close(POPUP_ANIMATION_NONE);

    Main.panel.menuManager?.removeMenu(menu);
    menu.destroy();
}

export function placeIndicatorInPanel(indicator, settings) {
    if (!indicator)
        return;

    const currentParent = indicator.get_parent();
    if (currentParent)
        currentParent.remove_child(indicator);

    const boxes = {
        left: Main.panel._leftBox,
        center: Main.panel._centerBox,
        right: Main.panel._rightBox,
    };
    const targetBox = boxes[settings.get_string('tray-position')] ?? Main.panel._rightBox;

    if (targetBox)
        targetBox.insert_child_at_index(indicator, settings.get_int('tray-order'));
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

// Shell's own panel styling has to come off before a custom one can take
// over, the two fight over padding and color otherwise. XEmbed passes no
// iconActor, its pixmap has no St icon to strip.
export function applyPanelClasses(actor, iconActor, enableCustom) {
    const apply = (target, cls) => {
        if (!target)
            return;
        if (enableCustom)
            target.remove_style_class_name(cls);
        else
            target.add_style_class_name(cls);
    };
    apply(actor, 'panel-button');
    apply(iconActor, 'system-status-icon');
}

// XEmbed icons are opaque X11 pixmaps, so `withColors: false` skips the
// foreground color rules for them.
export function computeTrayIconStyle(settings, {withColors = true} = {}) {
    const enableCustom = settings.get_boolean('enable-custom-icon-style');

    let baseStyle;
    if (enableCustom) {
        const padding = _sidesShorthand(settings, 'icon-padding');
        const margin = _sidesShorthand(settings, 'icon-margin');
        const radius = settings.get_int('icon-border-radius');
        const bg = accentAwareColor(settings, 'icon-background-color', 'icon-background-use-accent-color');
        const color = withColors ? ` color: ${accentAwareColor(settings, 'icon-color', 'icon-use-accent-color')};` : '';
        baseStyle = `padding: ${padding}; margin: ${margin}; border-radius: ${radius}px;${color} background-color: ${bg}; border: ${_borderShorthand(settings, 'icon-')}; box-shadow: none;`;
    } else {
        // Stock mode ignores the padding/margin settings, both only take over
        // once there's a custom shape for them to size or space out.
        baseStyle = `padding: ${DEFAULT_ICON_PADDING_PX}px; margin: 0px ${ICON_MARGIN_PX}px; border-radius: ${DEFAULT_PILL_RADIUS_PX}px; border: 0px; box-shadow: none;`;
    }

    const hoverBg = enableCustom
        ? accentAwareColor(settings, 'icon-hover-background-color', 'icon-hover-background-use-accent-color')
        : DEFAULT_HOVER_BG_COLOR;
    let hoverStyle = `${baseStyle} background-color: ${hoverBg};`;
    if (enableCustom) {
        if (withColors) {
            const hoverColor = accentAwareColor(settings, 'icon-hover-color', 'icon-hover-use-accent-color');
            if (hoverColor)
                hoverStyle += ` color: ${hoverColor};`;
        }
        hoverStyle += _hoverBorderCss(settings, 'icon-');
    }

    return {enableCustom, baseStyle, hoverStyle};
}

function _sidesShorthand(settings, prefix) {
    return BOX_SIDES.map(side => `${settings.get_int(`${prefix}-${side}`)}px`).join(' ');
}

// A missing color would leave an unparseable shorthand that St drops, and
// the theme border would bleed through instead of staying stripped.
function _borderShorthand(settings, prefix) {
    const color = accentAwareColor(settings, `${prefix}border-color`, `${prefix}border-use-accent-color`);
    return color ? `${settings.get_int(`${prefix}border-width`)}px solid ${color}` : '0px';
}

export function attachStatusIcon(actor) {
    const icon = new St.Icon({
        style_class: 'system-status-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    // The badge overlays the icon, and St.Bin holds one child, so both sit
    // in a BinLayout box. The box hugs the icon instead of filling the
    // panel button, so the badge corners land on the glyph. The label needs
    // the expand flags, BinLayout only honours align on expanding children.
    const box = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(icon);
    const badge = new St.Label({
        visible: false,
        x_expand: true,
        y_expand: true,
    });
    box.add_child(badge);
    actor.set_child(box);
    actor._badge = badge;
    return trackDisposal(icon);
}

function _badgeColor(style, accentField, colorField, fallback) {
    if (style?.[accentField])
        return ST_ACCENT_COLOR;
    return style?.[colorField] || fallback;
}

function _badgeAlign(position) {
    const name = BADGE_POSITIONS.includes(position) ? position : BADGE_POSITIONS[0];
    const [vertical, horizontal] = name.split('-');
    return [
        horizontal === 'left' ? Clutter.ActorAlign.START : Clutter.ActorAlign.END,
        vertical === 'top' ? Clutter.ActorAlign.START : Clutter.ActorAlign.END,
    ];
}

// badge is null to hide, or {text} where a null text means a plain dot.
// Restyled on every call because size, position and color can change
// under a visible badge.
export function setBadgeContent(actor, settings, badge, style = null) {
    const label = actor._badge;
    if (!label)
        return;
    if (!badge) {
        label.visible = false;
        return;
    }

    const [xAlign, yAlign] = _badgeAlign(style?.position);
    label.x_align = xAlign;
    label.y_align = yAlign;

    const iconSize = settings.get_int('icon-size');
    const bg = _badgeColor(style, 'color_accent', 'color', BADGE_DEFAULT_COLOR);

    if (badge.text === null) {
        const dot = style?.size > 0 ? style.size : Math.max(6, Math.round(iconSize * 0.3));
        // Unset radius is a full circle, and a value can't round more than half.
        const radius = Math.min(style?.radius ?? dot, Math.ceil(dot / 2));
        label.text = '';
        label.set_style(`background-color: ${bg}; ` +
            `width: ${dot}px; height: ${dot}px; border-radius: ${radius}px;`);
    } else {
        const font = style?.size > 0 ? style.size : Math.max(8, Math.round(iconSize * 0.4));
        const radius = style?.radius ?? font;
        const fg = _badgeColor(style, 'text_color_accent', 'text_color', BADGE_DEFAULT_TEXT_COLOR);
        label.text = badge.text;
        label.set_style(`background-color: ${bg}; color: ${fg}; ` +
            `font-size: ${font}px; font-weight: bold; padding: 0px 3px; ` +
            `border-radius: ${radius}px; min-width: ${Math.ceil(font * 0.8)}px; text-align: center;`);
    }
    label.visible = true;
}

// gicon and icon_name are two hands on one St.Icon, the losing one has to
// be cleared or its stale value keeps rendering.
export function setIconContent(iconActor, gicon, iconName) {
    if (gicon) {
        iconActor.icon_name = null;
        iconActor.set_gicon(gicon);
    } else {
        iconActor.set_gicon(null);
        iconActor.icon_name = iconName;
    }
}

export function refreshTrayStyle(actor, iconActor, settings) {
    iconActor.set_icon_size(settings.get_int('icon-size'));

    const {enableCustom, baseStyle, hoverStyle} = computeTrayIconStyle(settings);
    applyPanelClasses(actor, iconActor, enableCustom);

    actor._baseStyle = baseStyle;
    actor._hoverStyle = hoverStyle;
    syncHoverStyle(actor);
}

export function syncHoverStyle(actor) {
    actor.set_style(actor.hover ? actor._hoverStyle : actor._baseStyle);
}

export function computeToggleStyle(settings) {
    // panel-button and system-status-icon ship a min-size, border and hover
    // frame. The caller strips both when custom styling takes over so a
    // user-set 0 actually means 0.
    const customToggle = settings.get_boolean('enable-custom-toggle-style');
    // Tray icons on the default style have nothing to hand down, and the caller
    // has already stripped panel-button by then, so inheriting would leave the
    // toggle with no styling at all.
    const inheritIcons = customToggle &&
        settings.get_boolean('toggle-inherit-icon-style') &&
        settings.get_boolean('enable-custom-icon-style');

    if (inheritIcons) {
        const inheritedColor = accentAwareColor(settings, 'icon-color', 'icon-use-accent-color') || '#ffffff';
        return {
            baseStyle: _buildInheritedToggleBase(settings),
            hoverStyle: `background-color: ${accentAwareColor(settings, 'icon-hover-background-color', 'icon-hover-background-use-accent-color')};${
                _hoverBorderCss(settings, 'icon-')}`,
            iconColor: inheritedColor,
            iconHoverColor: accentAwareColor(settings, 'icon-hover-color', 'icon-hover-use-accent-color') ||
                inheritedColor,
        };
    }

    if (customToggle) {
        const baseColor = accentAwareColor(settings, 'toggle-icon-color', 'toggle-icon-use-accent-color') || '#ffffff';
        return {
            baseStyle: generateBoxStyle(settings, 'toggle-', {
                radiusPrefix: 'toggle-icon-',
                colorPrefix: 'toggle-icon-',
                extraCss: 'box-shadow: none;',
            }),
            hoverStyle: `background-color: ${accentAwareColor(settings, 'toggle-icon-hover-background-color', 'toggle-icon-hover-background-use-accent-color')};${
                _hoverBorderCss(settings, 'toggle-icon-')}`,
            iconColor: baseColor,
            iconHoverColor: accentAwareColor(settings, 'toggle-icon-hover-color', 'toggle-icon-hover-use-accent-color') || baseColor,
        };
    }

    return {baseStyle: '', hoverStyle: '', iconColor: '', iconHoverColor: ''};
}

function _buildInheritedToggleBase(settings) {
    const padding = _sidesShorthand(settings, 'icon-padding');
    const margin = _sidesShorthand(settings, 'icon-margin');
    const radius = settings.get_int('icon-border-radius');
    const color = accentAwareColor(settings, 'icon-color', 'icon-use-accent-color');
    const bg = accentAwareColor(settings, 'icon-background-color', 'icon-background-use-accent-color');
    return `padding: ${padding}; margin: ${margin}; border-radius: ${radius}px; color: ${color}; background-color: ${bg}; border: ${_borderShorthand(settings, 'icon-')}; box-shadow: none;`;
}

function _hoverBorderCss(settings, prefix) {
    const color = accentAwareColor(settings, `${prefix}hover-border-color`, `${prefix}hover-border-use-accent-color`);
    return color ? ` border-color: ${color};` : '';
}

