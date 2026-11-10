import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {clearIds, disconnectSignal, removeTimer} from '../../shared/lifecycle.js';

// The app maps its menu right after the ContextMenu call, a window that
// shows up later belongs to something else.
const MENU_WINDOW_WAIT_MS = 1500;

// On Wayland a menu without a parent surface is a plain toplevel and the app
// cannot place it, so mutter centres it on the screen. The shell may move any
// toplevel, and a move from the window's shown signal lands before its first
// frame, so the menu never shows up in the centre.
export class RemoteMenuPlacement {
    constructor(pid, anchor) {
        this._pid = pid;
        this._anchorRect = anchorRect(anchor);
        this._createdId = global.display.connect('window-created',
            (_display, window) => this._onWindowCreated(window));
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MENU_WINDOW_WAIT_MS, () => {
            this._timeoutId = 0;
            this.cancel();
            return GLib.SOURCE_REMOVE;
        });
        this._window = null;
        this._shownId = 0;
    }

    // A menu window carries no title and no parent, unlike the app's own windows
    _onWindowCreated(window) {
        const isMenu = window.get_pid() === this._pid &&
            window.get_window_type() === Meta.WindowType.NORMAL &&
            !window.get_transient_for() && !window.get_title();
        if (!isMenu)
            return;
        disconnectSignal(this, global.display, '_createdId');
        this._window = window;
        this._shownId = window.connect('shown', () => {
            this._place(window);
            this.cancel();
        });
    }

    _place(window) {
        const {width, height} = window.get_frame_rect();
        const anchor = this._anchorRect;
        const monitor = global.display.get_monitor_index_for_rect(anchor);
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        // A panel in the lower half opens upwards, like the shell's own menus
        const opensUp = anchor.y + anchor.height / 2 > area.y + area.height / 2;
        const top = opensUp ? anchor.y - height : anchor.y + anchor.height;
        const left = anchor.x + anchor.width / 2 - width / 2;
        window.move_frame(false,
            clamp(Math.round(left), area.x, area.x + area.width - width),
            clamp(Math.round(top), area.y, area.y + area.height - height));
    }

    cancel() {
        disconnectSignal(this, global.display, '_createdId');
        clearIds(this, removeTimer, '_timeoutId');
        disconnectSignal(this, this._window, '_shownId');
        this._window = null;
    }
}

// The pointer stands in when the anchor is not on screen
function anchorRect(anchor) {
    if (anchor?.mapped) {
        const [x, y] = anchor.get_transformed_position();
        const [width, height] = anchor.get_transformed_size();
        return new Mtk.Rectangle({x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height)});
    }
    const [x, y] = global.get_pointer();
    return new Mtk.Rectangle({x, y, width: 1, height: 1});
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}
