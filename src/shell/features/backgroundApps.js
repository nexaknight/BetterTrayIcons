import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {disconnectAll, clearIds, removeTimer} from '../../shared/lifecycle.js';

// The quick-settings item shows up within about 260 ms of login. This leaves
// an order of magnitude of headroom, and the poll still ends if a shell drops
// the item.
const BACKGROUND_TOGGLE_WAIT_MS = 3000;

const MICROSECONDS_PER_MS = 1000;

// Setting visible alone does not hide the shell's Quick Settings entry for
// windowless apps, its own _syncVisibility puts it back on every portal
// change or session mode update (status/backgroundApps.js in the shell's
// gresource). Only replacing that method on the instance makes it stay away.
export class BackgroundApps {
    constructor(settings) {
        this._settings = settings;
        this._settingsSignals = [];
        this._toggle = null;
        this._originalSync = null;
        this._findToggleId = 0;
    }

    enable() {
        this._settingsSignals.push(this._settings.connect(
            'changed::hide-background-apps', () => this._sync()));
        this._sync();
    }

    disable() {
        disconnectAll(this, this._settings, '_settingsSignals');
        clearIds(this, removeTimer, '_findToggleId');
        this._restore();
    }

    _sync() {
        // The shell can rebuild quick settings. The override then sits on a
        // dead instance while the new row shows again, so re-resolve first.
        if (this._originalSync && this._toggle !== this._findToggle())
            this._restore();

        if (this._settings.get_boolean('hide-background-apps'))
            this._hide();
        else
            this._restore();
    }

    _hide() {
        if (this._originalSync)
            return;

        const toggle = this._findToggle();
        if (!toggle) {
            // Quick Settings populates optional items through dynamic imports
            // after extensions are enabled, so this one can still be missing on
            // the first _sync(), see
            // https://discourse.gnome.org/t/main-panel-statusarea-quicksettings-system-is-undefined/16827
            this._awaitToggle();
            return;
        }
        this._applyOverride(toggle);
    }

    _awaitToggle() {
        if (this._findToggleId)
            return;
        const deadline = GLib.get_monotonic_time() + BACKGROUND_TOGGLE_WAIT_MS * MICROSECONDS_PER_MS;
        this._findToggleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const toggle = this._findToggle();
            if (toggle) {
                this._findToggleId = 0;
                this._applyOverride(toggle);
                return GLib.SOURCE_REMOVE;
            }
            if (GLib.get_monotonic_time() > deadline) {
                this._findToggleId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _applyOverride(toggle) {
        this._toggle = toggle;
        this._originalSync = toggle._syncVisibility;
        // The shell defines this on the class, so restoring it as an own
        // property would shadow whatever a later shell puts on the prototype.
        this._hadOwnSync = Object.hasOwn(toggle, '_syncVisibility');
        toggle._syncVisibility = () => {
            toggle.visible = false;
        };
        toggle.visible = false;
    }

    _restore() {
        clearIds(this, removeTimer, '_findToggleId');

        if (!this._originalSync)
            return;

        const toggle = this._toggle;
        const original = this._originalSync;
        this._toggle = null;
        this._originalSync = null;

        if (this._hadOwnSync)
            toggle._syncVisibility = original;
        else
            delete toggle._syncVisibility;
        toggle._syncVisibility();
    }

    _findToggle() {
        return Main.panel.statusArea.quickSettings._backgroundApps?.quickSettingsItems[0];
    }
}
