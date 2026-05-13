import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {warn, error} from '../../shared/logging.js';
import {disconnectAll} from '../../shared/lifecycle.js';
import {isDisposed} from '../utils/actor.js';
import {
    DRAG_ACTOR_MAX_SIZE_PX,
    DRAG_ACTOR_OPACITY,
    DRAG_SETTING_KEYS,
} from '../../const.js';

export const DraggableTrayIcon = GObject.registerClass(
class DraggableTrayIcon extends GObject.Object {
    _init(actor, appId, clickController, onDragStateChange) {
        super._init();
        this._actor = actor;
        this._appId = appId;
        this._clickController = clickController;
        this._onDragStateChange = onDragStateChange;

        // DND.makeDraggable is deferred until setEnabled(true). Attaching it
        // eagerly leaves the actor half-grabbed and blocks click events.
        this._enabled = false;
        this._initialized = false;
        this._isDragging = false;
        this._draggableSignals = [];

        if (!this._actor.reactive)
            this._actor.reactive = true;

        // Back-link so callers can find the wrapper via actor._draggableItem
        // even when DnD is currently disabled.
        this._actor._draggableItem = this;
    }

    setClickController(controller) {
        this._clickController = controller;
    }

    setEnabled(enabled) {
        const next = !!enabled;
        if (next === this._enabled)
            return;

        if (next) {
            this._initDraggable();
            this._enabled = this._initialized;
        } else {
            this._enabled = false;
            this._teardownDraggable();
        }
    }

    get enabled() {
        return this._enabled;
    }

    get appId() {
        return this._appId;
    }

    // Return a Clutter.Clone so the original St.Bin stays in its container.
    // Without this, DND would reparent and destroy the source actor.
    getDragActor() {
        if (!this._actor)
            return null;
        const [w, h] = this._actor.get_size();
        return new Clutter.Clone({
            source: this._actor,
            width: w,
            height: h,
        });
    }

    getDragActorSource() {
        return this._actor;
    }

    _initDraggable() {
        if (this._initialized)
            return;

        if (this._actor._draggable) {
            this._actor._draggable.destroy?.();
            this._actor._draggable = null;
        }

        try {
            this._draggable = DND.makeDraggable(this._actor, {
                dragActorMaxSize: DRAG_ACTOR_MAX_SIZE_PX,
                dragActorOpacity: DRAG_ACTOR_OPACITY,
            });
            if (!this._draggable) {
                warn(`DraggableTrayIcon: DND.makeDraggable returned null for ${this._appId}`);
                return;
            }

            this._draggable._draggableItem = this;

            // GNOME's DND module passes actor._delegate as the source to drop
            // targets. Without this, acceptDrop rejects every drop.
            this._actor._delegate = this;

            if (!this._actor._draggable)
                this._actor._draggable = this._draggable;

            this._connectSignals();
            this._initialized = true;
        } catch (e) {
            error(`DraggableTrayIcon: Init failed for ${this._appId}`, e);
        }
    }

    _teardownDraggable() {
        if (!this._initialized)
            return;

        this._cancelActiveDrag();

        disconnectAll(this, this._draggable, '_draggableSignals');
        try {
            if (this._actor)
                this._actor.disconnectObject(this._draggable);
        } catch { /* draggable disposed during shell teardown */ }

        // Reset to neutral visuals with plain assignments.
        // Animating scale on an actor being torn down produced NaN
        // allocations and crashed the shell.
        if (!isDisposed(this._actor)) {
            this._actor.remove_all_transitions();
            this._actor.opacity = 255;
            this._actor.scale_x = 1.0;
            this._actor.scale_y = 1.0;
        }

        if (this._actor && !isDisposed(this._actor)) {
            if (this._actor._delegate === this)
                this._actor._delegate = null;
            this._actor._draggable = null;
        }
        this._draggable = null;
        this._initialized = false;
        this._isDragging = false;
    }

    _connectSignals() {
        if (!this._draggable)
            return;
        this._draggableSignals.push(
            this._draggable.connect('drag-begin', this._onDragBegin.bind(this)),
            this._draggable.connect('drag-end', this._onDragEnd.bind(this)),
            this._draggable.connect('drag-cancelled', this._onDragCancelled.bind(this))
        );
    }

    _onDragBegin() {
        if (!this._enabled) {
            this._cancelActiveDrag();
            return;
        }

        this._isDragging = true;

        if (this._clickController?.cancel)
            this._clickController.cancel();

        // DND already paints the dragActor with its own opacity. Easing the
        // source's scale or opacity here would race against DND's
        // dragActorMaxSize tween and produce NaN.
        if (this._onDragStateChange)
            this._onDragStateChange(true);
    }

    _onDragEnd(_draggable, _time, _success) {
        this._isDragging = false;
        if (this._onDragStateChange)
            this._onDragStateChange(false);
    }

    _onDragCancelled() {
        this._isDragging = false;
        if (this._onDragStateChange)
            this._onDragStateChange(false);
    }

    _cancelActiveDrag() {
        if (!this._draggable || !this._isDragging)
            return;
        const time = global.get_current_time?.() ?? GLib.get_monotonic_time() / 1000;
        this._draggable._cancelDrag?.(time);
    }

    destroy() {
        if (this._initialized)
            this._teardownDraggable();
        if (this._actor && !isDisposed(this._actor)) {
            this._actor._draggableItem = null;
            if (this._actor._delegate === this)
                this._actor._delegate = null;
        }
        this._actor = null;
        this._clickController = null;
        this._onDragStateChange = null;
    }
});

// Floating drop marker. Lives in Main.layoutManager.uiGroup so it can move
// during drag without mutating any container's child list. Mutating actor
// children while DND iterates crashed the shell (g_hash_table_iter_next
// version-mismatch assertion in the past).
export class DragPlaceholder {
    constructor() {
        this._actor = null;
    }

    _ensureActor() {
        if (this._actor)
            return this._actor;
        this._actor = new St.Widget({
            width: 3,
            height: 24,
            reactive: false,
            style: 'background-color: rgba(255,255,255,0.9); border-radius: 2px;',
            visible: false,
        });
        Main.layoutManager.uiGroup.add_child(this._actor);
        return this._actor;
    }

    // `items` carry an `.actor` in render order. `targetIndex` is the
    // position the marker points to.
    showAt(items, targetIndex) {
        if (items.length === 0) {
            this.hide();
            return;
        }

        const placeholder = this._ensureActor();

        let px, py, height;
        try {
            if (targetIndex < items.length) {
                const [cx, cy] = items[targetIndex].actor.get_transformed_position();
                const [, ch] = items[targetIndex].actor.get_transformed_size();
                px = cx - 2;
                py = cy;
                height = ch;
            } else {
                const last = items[items.length - 1].actor;
                const [cx, cy] = last.get_transformed_position();
                const [cw, ch] = last.get_transformed_size();
                px = cx + cw - 1;
                py = cy;
                height = ch;
            }
        } catch {
            // Target actor disposed mid-drag.
            this.hide();
            return;
        }

        placeholder.set_position(Math.round(px), Math.round(py));
        placeholder.set_size(3, Math.round(height));
        placeholder.visible = true;

        // Each menu.open raises the popup actor inside uiGroup, so on
        // subsequent drags the placeholder would render behind the popup.
        // Re-raise on every motion event, which is cheap.
        const parent = placeholder.get_parent();
        if (parent) {
            try {
                parent.set_child_above_sibling(placeholder, null);
            } catch { /* parent gone mid-drag */ }
        }
    }

    hide() {
        if (this._actor)
            this._actor.visible = false;
    }

    destroy() {
        if (this._actor) {
            this.hide();
            this._actor.destroy();
            this._actor = null;
        }
    }
}

export function isDragEnabledFromSettings(settings) {
    if (!settings)
        return false;
    return DRAG_SETTING_KEYS.some(k => settings.get_string(k) === 'drag-drop');
}

export function setupIconDragSource({
    actor,
    appId,
    settings,
    label = appId,
    clickController = null,
    onLocalDragStateChange = null,
    onForwardedDragStateChange = null,
}) {
    let draggable;
    try {
        draggable = new DraggableTrayIcon(actor, appId, clickController, isDragging => {
            onLocalDragStateChange?.(isDragging);
            onForwardedDragStateChange?.(isDragging);
        });
    } catch (e) {
        warn(`setupIconDragSource: init failed for ${label}: ${e.message}`);
        return null;
    }
    draggable.setEnabled(isDragEnabledFromSettings(settings));
    return draggable;
}

// Opens the overflow popup at drag start, closes it at drag end.
export function forwardDragStateToIndicator(indicator) {
    return isDragging => {
        if (!indicator)
            return;
        if (isDragging)
            indicator._onAnyDragBegin?.();
        else
            indicator._onAnyDragEnd?.();
    };
}
