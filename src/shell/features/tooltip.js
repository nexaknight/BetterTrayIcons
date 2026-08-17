import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {warn, error} from '../../shared/logging.js';
import {clearIds, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed, trackDisposal} from '../utils/actor.js';

// Tray titles are app-provided and unbounded, so a long one would stretch
// the tooltip across the panel and off the monitor.
const TOOLTIP_MAX_WIDTH_PX = 400;

// A failed tooltip is not fatal, the icon works without one.
export function createTrayActor(label, settings) {
    const actor = trackDisposal(new St.Bin({
        reactive: true,
        can_focus: true,
        track_hover: true,
        y_expand: true,
        x_expand: false,
        y_align: Clutter.ActorAlign.FILL,
        x_align: Clutter.ActorAlign.CENTER,
    }));

    let tooltip = null;
    try {
        tooltip = new Tooltip(actor, settings);
    } catch (e) {
        warn(`Failed to create tooltip for ${label}: ${e.message}`);
    }

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
        // max-width caps a long title while a short label still shrinks to fit,
        // which a fixed width would not, and ellipsizing needs that bound to
        // have any effect.
        this._label.set_style(`max-width: ${TOOLTIP_MAX_WIDTH_PX}px;`);
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        trackDisposal(this._label);

        // uiGroup floats above panels and windows so the tooltip is never clipped.
        if (Main.layoutManager && Main.layoutManager.uiGroup)
            Main.layoutManager.uiGroup.add_child(this._label);
        else
            warn('Tooltip: Main.layoutManager.uiGroup not available. Tooltips will not work.');
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
        } else {
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._timeoutId = 0;
                this._show();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _show() {
        if (!this._sourceActor.get_parent())
            return;
        if (!this._label.text)
            return;

        try {
            const parent = this._label.get_parent();
            if (parent)
                parent.set_child_above_sibling(this._label, null);

            const [x, y] = this._sourceActor.get_transformed_position();
            const [w, h] = this._sourceActor.get_transformed_size();
            const labelWidth = this._label.get_width();
            const labelHeight = this._label.get_height();

            const positionPref = this._settings.get_string('tooltip-position');
            const spacing = 5;

            let targetX = x + (w / 2) - (labelWidth / 2);
            let targetY = positionPref === 'bottom'
                ? y + h + spacing
                : y - labelHeight - spacing;

            const monitor = Main.layoutManager.findMonitorForActor(this._sourceActor);
            if (monitor) {
                const minX = monitor.x + spacing;
                const maxX = monitor.x + monitor.width - labelWidth - spacing;
                targetX = Math.max(minX, Math.min(targetX, maxX));

                if (positionPref === 'bottom' && (targetY + labelHeight > monitor.y + monitor.height))
                    targetY = y - labelHeight - spacing;
                else if (positionPref === 'top' && (targetY < monitor.y))
                    targetY = y + h + spacing;
            }

            // Fractional positions land the glyphs on half pixels and blur
            // some tooltips while others stay sharp.
            this._label.set_position(Math.round(targetX), Math.round(targetY));
            this._label.show();
            this._label.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } catch (e) {
            // Source actor disposed mid-render.
            error('Tooltip render failed', e);
        }
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
            const parent = this._label.get_parent();
            if (parent)
                parent.remove_child(this._label);
            this._label.destroy();
        }
        this._label = null;
        this._sourceActor = null;
    }
}
