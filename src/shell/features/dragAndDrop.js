import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {warn, error} from '../../shared/logging.js';
import {disconnectAll} from '../../shared/lifecycle.js';
import {isDisposed} from '../utils/actor.js';

const DRAG_ACTOR_MAX_SIZE_PX = 48;

const DRAG_ACTOR_OPACITY = 180;

const DRAGGING_SOURCE_OPACITY = 60;

export const DRAG_SETTING_KEYS = Object.freeze([
    'tray-action-left-long',
    'tray-action-middle-long',
    'tray-action-right-long',
    'tray-action-tap-long',
]);

export class DraggableTrayIcon extends GObject.Object {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsDraggableTrayIcon'}, this);
    }

    _init(actor, appId, clickController, onDragStateChange) {
        super._init();
        this._actor = actor;
        this._appId = appId;
        this._clickController = clickController;
        this._onDragStateChange = onDragStateChange;

        // Attaching DND.makeDraggable eagerly leaves the actor half-grabbed and
        // blocks click events, so it waits for setEnabled(true).
        this._enabled = false;
        this._initialized = false;
        this._isDragging = false;
        this._draggableSignals = [];

        // Back-link so callers reach the wrapper even while DnD is disabled.
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

    // DND reparents and destroys whatever it gets, so hand it a clone and the
    // source St.Bin stays in its container.
    getDragActor() {
        if (!this._actor)
            return null;
        const [w, h] = this._actor.get_size();
        const icon = findIcon(this._actor);
        if (icon?.gicon) {
            const copy = new St.Bin({
                width: w,
                height: h,
                style_class: this._actor.style_class,
                style: this._actor.get_style(),
            });
            copy.set_child(new St.Icon({
                gicon: icon.gicon,
                icon_size: icon.icon_size,
                style: icon.get_style(),
            }));
            return copy;
        }
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
            const staleGesture = this._actor._draggable.startGesture;
            if (staleGesture)
                this._actor.remove_action(staleGesture);
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

            // GNOME's DND module passes actor._delegate as the source to drop targets.
            // Without this, acceptDrop rejects every drop.
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

        // Plain assignments, no easing: animating scale on an actor being torn
        // down produced NaN allocations and crashed the shell.
        if (!isDisposed(this._actor)) {
            this._actor.remove_all_transitions();
            this._actor.opacity = 255;
            this._actor.scale_x = 1.0;
            this._actor.scale_y = 1.0;
        }

        if (this._actor && !isDisposed(this._actor)) {
            // dnd.js never removes the start gesture it attached, left in place it
            // keeps starting drags after teardown, one more per re-enable.
            const gesture = this._draggable.startGesture;
            if (gesture)
                this._actor.remove_action(gesture);
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
            this._draggable.connect('drag-end', this._onDragStopped.bind(this)),
            this._draggable.connect('drag-cancelled', this._onDragStopped.bind(this))
        );
    }

    _onDragBegin() {
        this._isDragging = true;

        if (this._clickController?.cancel)
            this._clickController.cancel();

        // Easing the source's scale or opacity here races DND's dragActorMaxSize
        // tween and produces NaN.
        this._onDragStateChange(true);
    }

    _onDragStopped() {
        this._isDragging = false;
        this._onDragStateChange(false);
    }

    _cancelActiveDrag() {
        if (!this._isDragging)
            return;
        const time = global.get_current_time();
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
}

function findIcon(actor) {
    if (actor instanceof St.Icon)
        return actor;
    for (const child of actor.get_children()) {
        const found = findIcon(child);
        if (found)
            return found;
    }
    return null;
}

function isDragEnabledFromSettings(settings) {
    if (!settings)
        return false;
    return DRAG_SETTING_KEYS.some(k => settings.get_string(k) === 'drag-drop');
}

export function syncDragEnabled(draggable, settings) {
    draggable.setEnabled(isDragEnabledFromSettings(settings));
}

export function setupIconDragSource({
    actor,
    appId,
    settings,
    tooltip = null,
    onForwardedDragStateChange = null,
}) {
    const draggable = new DraggableTrayIcon(actor, appId, null, isDragging => {
        if (!isDisposed(actor)) {
            actor.opacity = isDragging ? DRAGGING_SOURCE_OPACITY : 255;
            // notify::hover does not re-fire if the pointer never left the icon, a
            // tooltip shown before the drag would stick.
            tooltip?.hide();
        }
        onForwardedDragStateChange?.(isDragging);
    });
    syncDragEnabled(draggable, settings);
    return draggable;
}

export function forwardDragStateToIndicator(indicator) {
    return isDragging => {
        if (isDragging)
            indicator._onAnyDragBegin();
        else
            indicator._onAnyDragEnd();
    };
}
