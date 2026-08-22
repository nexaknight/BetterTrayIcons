import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {DEFAULT_PILL_RADIUS_PX, DEFAULT_ICON_PADDING_PX, ICON_MARGIN_PX, BADGE_POSITIONS, BADGE_DEFAULT_COLOR, BADGE_DEFAULT_TEXT_COLOR} from '../../const.js';
import {usesAccent} from '../../shared/accentColor.js';
import {boxGeometryCss, borderShorthand} from '../../shared/boxStyle.js';

const DEFAULT_HOVER_BG_COLOR = 'rgba(255,255,255,0.1)';

const ST_ACCENT_COLOR = '-st-accent-color';

// Mirrors PopupAnimation.NONE.
export const POPUP_ANIMATION_NONE = 0;

// GJS logs a critical on every member access of a disposed GObject,
// toString included, and its string carries no disposed marker anymore.
// Probing is both noisy and blind, so track destruction ourselves.
const _destroyedActors = new WeakSet();

export function trackDisposal(actor) {
    actor.connect('destroy', () => _destroyedActors.add(actor));
    return actor;
}

export function isDisposed(actor) {
    return !actor || _destroyedActors.has(actor);
}

// An actor can be disposed mid-drag and mid-hit-test, and GJS answers calls
// on a disposed actor with garbage instead of throwing.
export function safeBounds(actor) {
    if (isDisposed(actor))
        return null;
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x, y, w, h];
}

// The allocation ignores a running slide, so this is where the actor will
// settle, not where it is drawn right now.
export function settledBounds(actor) {
    if (!actor.has_allocation())
        return null;
    const [px, py] = actor.get_parent().get_transformed_position();
    const box = actor.get_allocation_box();
    return [px + box.x1, py + box.y1, box.x2 - box.x1, box.y2 - box.y1];
}

export function stageScaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
}

export function generateBoxStyle(settings, prefix, options = {}) {
    const extraCss = options.extraCss || '';
    const radiusPrefix = options.radiusPrefix || prefix;
    const colorPrefix = options.colorPrefix || prefix;
    // Lets the overflow container keep a 1px gutter even when the user sets
    // margin: 0.
    const minMargin = options.minMargin || {};

    let css = boxGeometryCss(settings, {spacingPrefix: prefix, radiusPrefix, minMargin});

    // Not every prefix has both keys, overflow-container has only background.
    const schema = settings.settings_schema;
    const bgKey = `${colorPrefix}-background-color`;
    if (schema.has_key(bgKey)) {
        const bg = resolveColor(settings, bgKey);
        if (bg)
            css += ` background-color: ${bg};`;
    }
    const fgKey = `${colorPrefix}-color`;
    if (schema.has_key(fgKey)) {
        const col = resolveColor(settings, fgKey);
        if (col)
            css += ` color: ${col};`;
    }
    css += ` border: ${_borderShorthand(settings, colorPrefix)};`;

    if (extraCss)
        css += extraCss;

    return css;
}

// Handing St the -st-accent-color keyword instead of a resolved value lets it
// track the system accent itself, so nothing has to re-apply the style when
// the accent changes.
function resolveColor(settings, colorKey) {
    const value = settings.get_string(colorKey);
    return usesAccent(value) ? ST_ACCENT_COLOR : value;
}

export function createPanelMenu(sourceActor, configure = null) {
    const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.TOP);
    menu.actor.add_style_class_name('panel-menu');
    configure?.(menu);
    Main.layoutManager.uiGroup.add_child(menu.actor);
    menu.actor.hide();
    return menu;
}

// Popup icons anchor to the dummy cursor, an intellihide panel (Dash to
// Panel) otherwise slides away mid-menu and takes the menu with it.
export function menuAnchorFor(actor) {
    if (Main.panel.contains(actor))
        return actor;

    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    Main.layoutManager.setDummyCursorGeometry(x, y, w, h);
    return Main.layoutManager.dummyCursor;
}

let _detachedMenuManager = null;

// The panel manager closes its open menu when another opens, which would
// shut the popup under a context menu opened from inside it. A manager of
// its own lets both stay open, the popup stays the panel's active menu.
export function menuManagerFor(actor, settings) {
    if (settings.get_boolean('keep-popup-after-click') && !Main.panel.contains(actor)) {
        _detachedMenuManager ??= new PopupMenu.PopupMenuManager(Main.panel);
        return _detachedMenuManager;
    }
    return Main.panel.menuManager;
}

export function clearDetachedMenuManager() {
    _detachedMenuManager = null;
}

// The menu actor can already be C-disposed during shutdown.
export function destroyMenuSafely(menu) {
    if (!menu || isDisposed(menu.actor))
        return;

    // Without closing first, removeMenu leaves the manager pointing at this
    // menu and the next close pops a grab that is already gone.
    if (menu.isOpen)
        menu.close(POPUP_ANIMATION_NONE);

    Main.panel.menuManager.removeMenu(menu);
    menu.destroy();
}

export function placeIndicatorInPanel(indicator, settings) {
    const currentParent = indicator.get_parent();
    if (currentParent)
        currentParent.remove_child(indicator);

    const boxes = {
        left: Main.panel._leftBox,
        center: Main.panel._centerBox,
        right: Main.panel._rightBox,
    };
    const targetBox = boxes[settings.get_string('tray-position')] ?? Main.panel._rightBox;

    targetBox.insert_child_at_index(indicator, settings.get_int('tray-order'));
}

// A placement pass walks every icon, each real mutation costs a full
// container relayout.
export function moveActorToIndex(actor, parent, index) {
    if (isDisposed(actor) || isDisposed(parent))
        return;

    const current = actor.get_parent();
    if (current === parent) {
        if (parent.get_children().indexOf(actor) === index)
            return;
        parent.set_child_at_index(actor, index);
        return;
    }

    current?.remove_child(actor);
    parent.insert_child_at_index(actor, index);
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
        const bg = resolveColor(settings, 'icon-background-color');
        const color = withColors ? ` color: ${resolveColor(settings, 'icon-color')};` : '';
        baseStyle = `${boxGeometryCss(settings, {spacingPrefix: 'icon'})}${color}` +
            ` background-color: ${bg}; border: ${_borderShorthand(settings, 'icon')}; box-shadow: none;`;
    } else {
        baseStyle = '';
    }

    let hoverStyle = '';
    if (enableCustom) {
        const hoverBg = resolveColor(settings, 'icon-hover-background-color');
        hoverStyle = `${baseStyle} background-color: ${hoverBg};`;
        if (withColors) {
            const hoverColor = resolveColor(settings, 'icon-hover-color');
            if (hoverColor)
                hoverStyle += ` color: ${hoverColor};`;
        }
        hoverStyle += _hoverBorderCss(settings, 'icon');
    }

    return {enableCustom, baseStyle, hoverStyle};
}

function _borderShorthand(settings, prefix) {
    return borderShorthand(settings, prefix, key => resolveColor(settings, key));
}

export function attachStatusIcon(actor) {
    const icon = new St.Icon({
        style_class: 'system-status-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    // The box hugs the icon so the badge corners land on the glyph. The label
    // needs the expand flags, BinLayout only honours align on expanding children.
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
        const inheritedColor = resolveColor(settings, 'icon-color') || '#ffffff';
        return {
            baseStyle: computeTrayIconStyle(settings).baseStyle,
            hoverStyle: `background-color: ${resolveColor(settings, 'icon-hover-background-color')};${
                _hoverBorderCss(settings, 'icon')}`,
            iconColor: inheritedColor,
            iconHoverColor: resolveColor(settings, 'icon-hover-color') || inheritedColor,
        };
    }

    if (customToggle) {
        const baseColor = resolveColor(settings, 'toggle-icon-color') || '#ffffff';
        return {
            baseStyle: generateBoxStyle(settings, 'toggle', {
                radiusPrefix: 'toggle-icon',
                colorPrefix: 'toggle-icon',
                extraCss: ' box-shadow: none;',
            }),
            hoverStyle: `background-color: ${resolveColor(settings, 'toggle-icon-hover-background-color')};${
                _hoverBorderCss(settings, 'toggle-icon')}`,
            iconColor: baseColor,
            iconHoverColor: resolveColor(settings, 'toggle-icon-hover-color') || baseColor,
        };
    }

    return {baseStyle: '', hoverStyle: '', iconColor: '', iconHoverColor: ''};
}

function _hoverBorderCss(settings, prefix) {
    const color = resolveColor(settings, `${prefix}-hover-border-color`);
    return color ? ` border-color: ${color};` : '';
}

