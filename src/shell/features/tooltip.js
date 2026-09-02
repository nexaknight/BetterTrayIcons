import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {clearIds, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed, trackDisposal} from '../disposal.js';

// Tray titles are app-provided and unbounded, so a long one would stretch
// the tooltip across the panel and off the monitor.
const TOOLTIP_MAX_WIDTH_PX = 400;

const TOOLTIP_GAP_PX = 5;

const TOOLTIP_FADE_MS = 200;

export function createTrayActor(settings) {
    const actor = trackDisposal(new St.Bin({
        reactive: true,
        can_focus: true,
        track_hover: true,
        y_expand: true,
        x_expand: false,
        y_align: Clutter.ActorAlign.FILL,
        x_align: Clutter.ActorAlign.CENTER,
    }));

    const tooltip = new Tooltip(actor, settings);

    return {actor, tooltip};
}

export function syncTooltip(actor, tooltip, settings) {
    if (!tooltip)
        return;
    if (actor.hover && settings.get_boolean('enable-tooltips'))
        tooltip.trigger();
    else
        tooltip.hide();
}

// The accessible name follows the tooltip switch so screen readers and the
// tooltip announce the same thing, or nothing at all.
export function applyTitle(actor, tooltip, settings, title) {
    const show = settings.get_boolean('enable-tooltips');
    actor.accessible_name = show && title ? title : '';
    if (tooltip)
        tooltip.text = title;
}

export class Tooltip {
    constructor(sourceActor, settings) {
        this._sourceActor = sourceActor;
        this._settings = settings;
        this._timeoutId = 0;

        this._label = new St.Label({
            style_class: 'dash-label',
            text: '',
            visible: false,
            opacity: 0,
        });
        // A short label still shrinks to fit under max-width, which a fixed
        // width would not allow, and ellipsizing needs the bound to do anything.
        this._label.set_style(`max-width: ${TOOLTIP_MAX_WIDTH_PX}px;`);
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        trackDisposal(this._label);

        // A direct uiGroup child sits above the panel and every window,
        // addChrome would drop it under top_window_group.
        Main.layoutManager.uiGroup.add_child(this._label);
    }

    set text(text) {
        const newText = text || '';
        if (this._label.text !== newText)
            this._label.text = newText;
    }

    trigger() {
        clearIds(this, removeTimer, '_timeoutId');

        const delay = this._settings.get_int('tooltip-delay');

        if (delay === 0) {
            this._show();
            return;
        }

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeoutId = 0;
            this._show();
            return GLib.SOURCE_REMOVE;
        });
    }

    _show() {
        if (!this._sourceActor.get_parent())
            return;
        if (!this._label.text)
            return;

        this._label.get_parent().set_child_above_sibling(this._label, null);

        const [x, y] = this._sourceActor.get_transformed_position();
        const [w, h] = this._sourceActor.get_transformed_size();
        const labelWidth = this._label.get_width();
        const labelHeight = this._label.get_height();

        const position = this._settings.get_string('tooltip-position');

        let targetX = x + (w / 2) - (labelWidth / 2);
        let targetY = position === 'bottom'
            ? y + h + TOOLTIP_GAP_PX
            : y - labelHeight - TOOLTIP_GAP_PX;

        const monitor = Main.layoutManager.findMonitorForActor(this._sourceActor);
        if (monitor) {
            const minX = monitor.x + TOOLTIP_GAP_PX;
            const maxX = monitor.x + monitor.width - labelWidth - TOOLTIP_GAP_PX;
            targetX = Math.max(minX, Math.min(targetX, maxX));

            if (position === 'bottom' && (targetY + labelHeight > monitor.y + monitor.height))
                targetY = y - labelHeight - TOOLTIP_GAP_PX;
            else if (position === 'top' && (targetY < monitor.y))
                targetY = y + h + TOOLTIP_GAP_PX;
        }

        this._label.set_position(Math.round(targetX), Math.round(targetY));
        this._label.show();
        this._label.ease({
            opacity: 255,
            duration: TOOLTIP_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    hide() {
        clearIds(this, removeTimer, '_timeoutId');

        if (this._label.visible) {
            this._label.remove_transition('opacity');
            this._label.opacity = 0;
            this._label.hide();
        }
    }

    destroy() {
        clearIds(this, removeTimer, '_timeoutId');
        if (this._label && !isDisposed(this._label)) {
            this._label.get_parent().remove_child(this._label);
            this._label.destroy();
        }
        this._label = null;
        this._sourceActor = null;
    }
}
