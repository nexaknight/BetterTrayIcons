import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {BADGE_POSITIONS, BADGE_DEFAULT_COLOR, BADGE_DEFAULT_TEXT_COLOR} from '../../const.js';
import {trackDisposal} from '../disposal.js';
import {ST_ACCENT_COLOR} from '../trayStyle.js';

const BADGE_DOT_ICON_RATIO = 0.3;
const BADGE_DOT_MIN_PX = 6;
const BADGE_TEXT_ICON_RATIO = 0.4;
const BADGE_TEXT_MIN_PX = 8;
const BADGE_TEXT_MIN_WIDTH_RATIO = 0.8;
const BADGE_TEXT_PADDING_X_PX = 3;

export function attachStatusIcon(actor) {
    const icon = new St.Icon({
        style_class: 'system-status-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const box = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(icon);
    // The label needs the expand flags, BinLayout only honours align on
    // expanding children.
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
        const dot = style?.size > 0
            ? style.size
            : Math.max(BADGE_DOT_MIN_PX, Math.round(iconSize * BADGE_DOT_ICON_RATIO));
        const radius = Math.min(style?.radius ?? dot, Math.ceil(dot / 2));
        label.text = '';
        label.set_style(`background-color: ${bg}; ` +
            `width: ${dot}px; height: ${dot}px; border-radius: ${radius}px;`);
    } else {
        const font = style?.size > 0
            ? style.size
            : Math.max(BADGE_TEXT_MIN_PX, Math.round(iconSize * BADGE_TEXT_ICON_RATIO));
        const radius = style?.radius ?? font;
        const fg = _badgeColor(style, 'text_color_accent', 'text_color', BADGE_DEFAULT_TEXT_COLOR);
        label.text = badge.text;
        label.set_style(`background-color: ${bg}; color: ${fg}; ` +
            `font-size: ${font}px; font-weight: bold; padding: 0px ${BADGE_TEXT_PADDING_X_PX}px; ` +
            `border-radius: ${radius}px; min-width: ${Math.ceil(font * BADGE_TEXT_MIN_WIDTH_RATIO)}px; text-align: center;`);
    }
    label.visible = true;
}

function _badgeAlign(position) {
    const name = BADGE_POSITIONS.includes(position) ? position : BADGE_POSITIONS[0];
    const [vertical, horizontal] = name.split('-');
    return [
        horizontal === 'left' ? Clutter.ActorAlign.START : Clutter.ActorAlign.END,
        vertical === 'top' ? Clutter.ActorAlign.START : Clutter.ActorAlign.END,
    ];
}

function _badgeColor(style, accentField, colorField, fallback) {
    if (style?.[accentField])
        return ST_ACCENT_COLOR;
    return style?.[colorField] || fallback;
}
