import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {clearIds, disconnectAll, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed} from '../utils/actor.js';
import {
    LONG_PRESS_TIMEOUT_MS,
    DOUBLE_CLICK_MAX_DELAY_MS,
    DND_DRAG_THRESHOLD_PX,
} from '../../const.js';

export class ClickController {
    constructor(actor, settings, keyPrefix, onAction, options = {}) {
        this._actor = actor;
        this._settings = settings;
        this._prefix = keyPrefix;
        this._onAction = onAction;
        this._propagate = options.propagateEvent === true;

        this._state = {
            longPressId: 0,
            doubleClickId: 0,
            isLongPress: false,
            lastClickTime: 0,
            clickCount: 0,
            pressStartX: 0,
            pressStartY: 0,
        };

        this._signals = [];
        this._connectSignals();
    }

    _connectSignals() {
        if (!this._actor)
            return;

        const connect = (signal, callback) => {
            const id = this._actor.connect(signal, callback);
            this._signals.push(id);
        };

        connect('button-press-event', this._onPress.bind(this));
        connect('button-release-event', this._onRelease.bind(this));
        connect('motion-event', this._onMotion.bind(this));
        connect('destroy', () => this.destroy());
    }

    _getDoubleClickTime() {
        const shellSettings = Clutter.Settings.get_default();
        let val = shellSettings ? shellSettings.double_click_time : DOUBLE_CLICK_MAX_DELAY_MS;
        if (val > DOUBLE_CLICK_MAX_DELAY_MS)
            val = DOUBLE_CLICK_MAX_DELAY_MS;
        return val;
    }

    _onPress(actor, event) {
        const button = event.get_button();
        const eventTime = event.get_time();
        const doubleClickTime = this._getDoubleClickTime();
        const [x, y] = event.get_coords();

        this._state.pressStartX = x;
        this._state.pressStartY = y;

        if (this._state.lastClickTime > 0 && (eventTime - this._state.lastClickTime) < doubleClickTime)
            this._state.clickCount = 2;
        else
            this._state.clickCount = 1;


        this._state.lastClickTime = eventTime;
        this._state.isLongPress = false;

        clearIds(this._state, removeTimer, 'doubleClickId');

        if (this._state.clickCount === 1) {
            clearIds(this._state, removeTimer, 'longPressId');

            this._state.longPressId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LONG_PRESS_TIMEOUT_MS, () => {
                this._state.isLongPress = true;
                this._state.longPressId = 0;
                this._triggerAction(button, 'long');
                return GLib.SOURCE_REMOVE;
            });
        } else {
            clearIds(this._state, removeTimer, 'longPressId');
        }

        return this._propagate ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
    }

    _onMotion(actor, event) {
        if (this._state.clickCount === 0 || this._state.isLongPress)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const dx = Math.abs(x - this._state.pressStartX);
        const dy = Math.abs(y - this._state.pressStartY);

        if (dx > DND_DRAG_THRESHOLD_PX || dy > DND_DRAG_THRESHOLD_PX) {
            // Cancel internal click timers only. Releasing the pointer grab
            // here would break DnD on GNOME Shell 45+.
            this.cancel();
            this._state.clickCount = 0;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onRelease(actor, event) {
        const button = event.get_button();

        const [x, y] = event.get_coords();
        const [success, localX, localY] = actor.transform_stage_point(x, y);
        const isInside = success && localX >= 0 && localX < actor.width && localY >= 0 && localY < actor.height;

        const count = this._state.clickCount;

        clearIds(this._state, removeTimer, 'longPressId');

        if (this._state.isLongPress) {
            this._state.isLongPress = false;
            this._state.clickCount = 0;
            return this._propagate ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
        }

        if (!isInside) {
            this._state.clickCount = 0;
            return this._propagate ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
        }

        if (count === 1)
            this._onSingleClickRelease(button);
        else if (count === 2)
            this._onDoubleClickRelease(button);
        else
            this._state.clickCount = 0;


        return this._propagate ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
    }

    _onSingleClickRelease(button) {
        const buttonName = this._getButtonName(button);
        const doubleKey = `${this._prefix}-action-${buttonName}-double`;
        const doubleAction = this._settings.get_string(doubleKey);

        const hasDoubleAction = doubleAction && doubleAction !== 'nothing';

        if (!hasDoubleAction) {
            this._triggerAction(button, 'single');
            this._state.clickCount = 0;
        } else {
            const delay = this._getDoubleClickTime();

            this._state.doubleClickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._state.doubleClickId = 0;
                this._triggerAction(button, 'single');
                this._state.clickCount = 0;
                this._state.lastClickTime = 0;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _onDoubleClickRelease(button) {
        clearIds(this._state, removeTimer, 'doubleClickId');

        this._triggerAction(button, 'double');

        this._state.clickCount = 0;
        this._state.lastClickTime = 0;
    }

    _getButtonName(button) {
        if (button === 2)
            return 'middle';
        if (button === 3)
            return 'right';
        return 'left';
    }

    _triggerAction(button, type) {
        const buttonName = this._getButtonName(button);

        let key = `${this._prefix}-action-${buttonName}`;
        if (type === 'double')
            key += '-double';
        if (type === 'long')
            key += '-long';

        const actionName = this._settings.get_string(key);

        if (actionName && this._onAction)
            this._onAction(actionName);
    }

    cancel() {
        clearIds(this._state, removeTimer, 'longPressId', 'doubleClickId');
        this._state.isLongPress = false;
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
