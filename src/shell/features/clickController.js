import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {clearIds, disconnectAll, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed} from '../disposal.js';
import {TOUCH_BINDING} from '../../const.js';

const LONG_PRESS_TIMEOUT_MS = 600;

const DOUBLE_CLICK_MAX_DELAY_MS = 250;

// Matches GTK's default drag threshold.
const DND_DRAG_THRESHOLD_PX = 8;

const MIDDLE_MOUSE_BUTTON = 2;

const RIGHT_MOUSE_BUTTON = 3;

export class ClickController {
    constructor(actor, settings, keyPrefix, onAction, options = {}) {
        this._actor = actor;
        this._settings = settings;
        this._prefix = keyPrefix;
        this._onAction = onAction;
        this._eventResult = options.propagateEvent === true
            ? Clutter.EVENT_PROPAGATE
            : Clutter.EVENT_STOP;

        this._state = {
            longPressId: 0,
            doubleClickId: 0,
            isLongPress: false,
            buttonDown: false,
            lastClickTime: 0,
            lastBinding: null,
            clickCount: 0,
            pressStartX: 0,
            pressStartY: 0,
        };

        this._signals = [];
        this._connectSignals();
    }

    _connectSignals() {
        const connect = (signal, callback) => {
            const id = this._actor.connect(signal, callback);
            this._signals.push(id);
        };

        connect('button-press-event', this._onPress.bind(this));
        connect('button-release-event', this._onRelease.bind(this));
        connect('motion-event', this._onMotion.bind(this));
        connect('touch-event', this._onTouch.bind(this));
        connect('destroy', () => this.destroy());
    }

    // Clutter emulates no pointer for touch, so a tap reaches none of the
    // handlers above.
    _onTouch(actor, event) {
        switch (event.type()) {
        case Clutter.EventType.TOUCH_BEGIN:
            return this._onPress(actor, event, TOUCH_BINDING);
        case Clutter.EventType.TOUCH_UPDATE:
            return this._onMotion(actor, event);
        case Clutter.EventType.TOUCH_END:
            return this._onRelease(actor, event, TOUCH_BINDING);
        case Clutter.EventType.TOUCH_CANCEL:
            this.cancel();
            return Clutter.EVENT_PROPAGATE;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _onPress(actor, event, binding = _bindingOf(event.get_button())) {
        const eventTime = event.get_time();
        const doubleClickTime = this._getDoubleClickTime();
        const [x, y] = event.get_coords();

        this._state.pressStartX = x;
        this._state.pressStartY = y;
        this._state.buttonDown = true;

        const isRepeatOfLastBinding = this._state.lastClickTime > 0 &&
            binding === this._state.lastBinding;
        const isInsideDoubleWindow =
            (eventTime - this._state.lastClickTime) < doubleClickTime;

        // Alternating buttons within the window is two singles, not a double.
        if (isRepeatOfLastBinding && isInsideDoubleWindow)
            this._state.clickCount = 2;
        else
            this._state.clickCount = 1;

        this._state.lastClickTime = eventTime;
        this._state.lastBinding = binding;
        this._state.isLongPress = false;

        clearIds(this._state, removeTimer, 'doubleClickId', 'longPressId');

        if (this._state.clickCount === 1) {
            const longPressMs = _gestureSetting('long_press_duration', LONG_PRESS_TIMEOUT_MS);
            this._state.longPressId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, longPressMs, () => {
                this._state.isLongPress = true;
                this._state.longPressId = 0;
                this._triggerAction(binding, 'long');
                return GLib.SOURCE_REMOVE;
            });
        }

        return this._eventResult;
    }

    _onMotion(actor, event) {
        // After a release the click may still sit on the double-click decision
        // timer, and pointer travel must not swallow it.
        if (!this._state.buttonDown || this._state.isLongPress)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const dx = Math.abs(x - this._state.pressStartX);
        const dy = Math.abs(y - this._state.pressStartY);

        const threshold = _gestureSetting('dnd_drag_threshold', DND_DRAG_THRESHOLD_PX);
        if (dx > threshold || dy > threshold) {
            // Cancel internal click timers only. Releasing the pointer grab
            // here would break DnD on GNOME Shell 45+.
            this.cancel();
            this._state.clickCount = 0;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onRelease(actor, event, binding = _bindingOf(event.get_button())) {
        this._state.buttonDown = false;

        const [x, y] = event.get_coords();
        const [success, localX, localY] = actor.transform_stage_point(x, y);
        const isInsideWidth = localX >= 0 && localX < actor.width;
        const isInsideHeight = localY >= 0 && localY < actor.height;
        const isInside = success && isInsideWidth && isInsideHeight;

        const count = this._state.clickCount;

        clearIds(this._state, removeTimer, 'longPressId');

        if (this._state.isLongPress) {
            this._state.isLongPress = false;
            this._state.clickCount = 0;
            return this._eventResult;
        }

        if (!isInside) {
            this._state.clickCount = 0;
            return this._eventResult;
        }

        if (count === 1)
            this._onSingleClickRelease(binding);
        else if (count === 2)
            this._onDoubleClickRelease(binding);
        else
            this._state.clickCount = 0;

        return this._eventResult;
    }

    _onSingleClickRelease(binding) {
        const doubleKey = `${this._prefix}-action-${binding}-double`;
        const doubleAction = this._settings.get_string(doubleKey);

        const hasDoubleAction = doubleAction && doubleAction !== 'nothing';

        if (!hasDoubleAction) {
            this._triggerAction(binding, 'single');
            this._state.clickCount = 0;
            // Otherwise the next fast click counts as a double and feeds an
            // action that is not configured, swallowing the click.
            this._state.lastClickTime = 0;
        } else {
            const delay = this._getDoubleClickTime();

            this._state.doubleClickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._state.doubleClickId = 0;
                this._triggerAction(binding, 'single');
                this._state.clickCount = 0;
                this._state.lastClickTime = 0;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _onDoubleClickRelease(binding) {
        clearIds(this._state, removeTimer, 'doubleClickId');

        this._triggerAction(binding, 'double');

        this._state.clickCount = 0;
        this._state.lastClickTime = 0;
    }

    // The system value is tuned for opening files, waiting that long before
    // a single click fires makes the tray feel unresponsive.
    _getDoubleClickTime() {
        return Math.min(
            _gestureSetting('double_click_time', DOUBLE_CLICK_MAX_DELAY_MS),
            DOUBLE_CLICK_MAX_DELAY_MS
        );
    }

    _triggerAction(binding, type) {
        let key = `${this._prefix}-action-${binding}`;
        if (type === 'double')
            key += '-double';
        if (type === 'long')
            key += '-long';

        const actionName = this._settings.get_string(key);

        if (actionName)
            this._onAction(actionName);
    }

    cancel() {
        clearIds(this._state, removeTimer, 'longPressId', 'doubleClickId');
        this._state.isLongPress = false;
        this._state.buttonDown = false;
        this._state.clickCount = 0;
        this._state.lastClickTime = 0;
    }

    destroy() {
        this.cancel();
        if (!isDisposed(this._actor))
            disconnectAll(this, this._actor, '_signals');
        this._signals = [];
        this._actor = null;
    }
}

function _bindingOf(button) {
    if (button === MIDDLE_MOUSE_BUTTON)
        return 'middle';
    if (button === RIGHT_MOUSE_BUTTON)
        return 'right';
    return 'left';
}

function _gestureSetting(property, fallback) {
    const value = Clutter.Settings.get_default()[property];
    return typeof value === 'number' && value > 0 ? value : fallback;
}
