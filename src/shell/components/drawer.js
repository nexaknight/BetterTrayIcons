import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {disconnectSignal} from '../../shared/lifecycle.js';
import {keepsOverflowOpen} from '../popupMenus.js';
import {motionAllowed} from '../trayStyle.js';
import {OverflowSurface} from './overflowMenu.js';

const OPEN_MS = 150;
const CLOSE_MS = 120;

// Edge to edge like the visible box, the icons' own margins make the gaps.
// The width rounds up already, so no cell comes out narrower than an icon.
const PANEL_PACKING = Object.freeze({spacing: 0, sidePadding: 0, slack: 0});

// Holds the overflow icons inline in the panel and unfolds on the far side of
// the visible icons. Without a remembered state it grabs like a popup, so a
// click anywhere else closes it.
export class Drawer extends OverflowSurface {
    constructor(settings, host, onOpenStateChanged) {
        super(settings, onOpenStateChanged, PANEL_PACKING);
        this._host = host;
        this._isOpen = false;
        this._grab = null;
        this._isGrabSuspended = false;

        // A fixed layout keeps the box at its own width while the clip is
        // narrower, a bin would squeeze it into more rows.
        this._actor = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            visible: false,
        });
        this._actor.add_child(this._container);
        this._edge = new Clutter.AlignConstraint({source: this._actor, align_axis: Clutter.AlignAxis.X_AXIS});
        this._container.add_constraint(this._edge);
        this._container.add_constraint(new Clutter.AlignConstraint({
            source: this._actor,
            align_axis: Clutter.AlignAxis.Y_AXIS,
            factor: 0.5,
        }));
        host.add_child(this._actor);

        this._capturedEventId = host.connect('captured-event', (_actor, event) => this._onCapturedEvent(event));
    }

    get inlineActor() {
        return this._actor;
    }

    get isOpen() {
        return this._isOpen;
    }

    // Drawer mode has no hover sibling in the panel's menu manager
    get isAttached() {
        return false;
    }

    _columnCount(itemCount) {
        return itemCount;
    }

    applyStyle() {
        this.updateGeometry();
    }

    open() {
        if (this._isOpen)
            return;
        this._isOpen = true;
        this._takeGrab();
        if (!this._actor.visible) {
            this._actor.width = 0;
            this._actor.show();
        }
        // Icons restyle once they move in, so the last layout pass sized them with the old style
        this.updateGeometry();
        const [, width] = this._container.get_preferred_width(-1);
        // Unpinned again once open, so the drawer follows icons coming and going
        this._slide(width, OPEN_MS, Clutter.AnimationMode.EASE_OUT_QUAD, () => (this._actor.width = -1));
        this._onOpenStateChanged(true);
    }

    close() {
        if (!this._isOpen)
            return;
        this._isOpen = false;
        this._dropGrab();
        this._slide(0, CLOSE_MS, Clutter.AnimationMode.EASE_IN_QUAD, () => this._actor.hide());
        this._onOpenStateChanged(false);
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    // The box rides on the outer edge, so it slides out from behind the
    // visible icons.
    _slide(width, duration, mode, onComplete) {
        this._edge.factor = this._settings.get_string('toggle-position') === 'left' ? 1 : 0;
        this._actor.ease({
            width,
            duration: motionAllowed() ? duration : 0,
            mode,
            onComplete,
        });
    }

    afterIconClick() {
        if (!keepsOverflowOpen(this._settings))
            this.close();
    }

    // A drag holds its own grab, ours waits until it ends
    detachFromManager() {
        this._isGrabSuspended = true;
        this._dropGrab();
    }

    attachToManager() {
        this._isGrabSuspended = false;
    }

    restoreManagerGrab() {
        this._takeGrab();
    }

    _takeGrab() {
        const canGrab = this._isOpen && !this._grab && !this._isGrabSuspended;
        if (!canGrab || keepsOverflowOpen(this._settings))
            return;
        this._grab = Main.pushModal(this._host);
    }

    _dropGrab() {
        if (!this._grab)
            return;
        Main.popModal(this._grab);
        this._grab = null;
    }

    _onCapturedEvent(event) {
        if (!this._grab)
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        const isEscape = type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape;
        const isPress = type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN;
        const isOutside = isPress && !this._host.contains(global.stage.get_event_actor(event));
        if (!isEscape && !isOutside)
            return Clutter.EVENT_PROPAGATE;

        this.close();
        return Clutter.EVENT_STOP;
    }

    destroy() {
        this._dropGrab();
        disconnectSignal(this, this._host, '_capturedEventId');
        this._actor.remove_all_transitions();
        this._actor.destroy();
        this._actor = null;
        this._container = null;
        this._host = null;
    }
}
