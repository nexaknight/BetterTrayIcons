import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {warn, error} from '../../shared/logging.js';
import {clearIds, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed} from '../utils/actor.js';

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
        if (!this._label || !this._sourceActor || !this._sourceActor.get_parent())
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

                // Flip to the other side if the preferred position clips the monitor.
                if (positionPref === 'bottom' && (targetY + labelHeight > monitor.y + monitor.height))
                    targetY = y - labelHeight - spacing;
                else if (positionPref === 'top' && (targetY < monitor.y))
                    targetY = y + h + spacing;
            }

            this._label.set_position(targetX, targetY);
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

        if (this._label && this._label.visible) {
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
