import GLib from 'gi://GLib';

import {disconnectAll, clearIds, removeTimer} from '../../shared/lifecycle.js';
import {watchDisposal} from '../disposal.js';
import {connectPanelCopies, disconnectPanelCopies, panelCopies} from '../panelCopies.js';

// The quick-settings item shows up within about 260 ms of login. This leaves
// an order of magnitude of headroom, and the poll still ends if a shell drops
// the item.
export const BACKGROUND_TOGGLE_WAIT_MS = 3000;

const MICROSECONDS_PER_MS = 1000;

const SYNC_KEYS = Object.freeze(['hide-background-apps', 'show-on-all-monitors']);

// Setting visible alone does not hide the Quick Settings entry for windowless
// apps, its own _syncVisibility (status/backgroundApps.js) puts it back on
// every portal or session mode change. Only an instance override holds.
export class BackgroundApps {
    constructor(settings) {
        this._settings = settings;
        this._settingsSignals = [];
        // Keyed by toggle, not by panel. Dash to Panel pools a Quick Settings
        // it takes off a panel, and that one must still be restored.
        this._overrides = new Map();
        this._findToggleId = 0;
        this._copiesChangedId = 0;
    }

    enable() {
        for (const key of SYNC_KEYS)
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => this._sync()));
        this._copiesChangedId = connectPanelCopies(() => this._sync());
        this._sync();
    }

    disable() {
        disconnectAll(this, this._settings, '_settingsSignals');
        clearIds(this, disconnectPanelCopies, '_copiesChangedId');
        clearIds(this, removeTimer, '_findToggleId');
        for (const toggle of [...this._overrides.keys()])
            this._restore(toggle);
    }

    _sync() {
        const {found, isComplete} = this._settings.get_boolean('hide-background-apps')
            ? backgroundAppsToggles(this._settings)
            : {found: [], isComplete: true};
        const toggles = found.map(({toggle}) => toggle);
        for (const toggle of [...this._overrides.keys()]) {
            if (!toggles.includes(toggle))
                this._restore(toggle);
        }
        toggles.forEach(toggle => this._applyOverride(toggle));

        // Quick Settings populates optional items through dynamic imports after
        // extensions are enabled, so a toggle can still be missing here
        // https://discourse.gnome.org/t/main-panel-statusarea-quicksettings-system-is-undefined/16827
        if (!isComplete)
            this._awaitToggles();
    }

    _awaitToggles() {
        if (this._findToggleId)
            return;
        const deadline = GLib.get_monotonic_time() + BACKGROUND_TOGGLE_WAIT_MS * MICROSECONDS_PER_MS;
        this._findToggleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const {found, isComplete} = backgroundAppsToggles(this._settings);
            found.forEach(({toggle}) => this._applyOverride(toggle));
            if (isComplete || GLib.get_monotonic_time() > deadline) {
                this._findToggleId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _applyOverride(toggle) {
        if (this._overrides.has(toggle))
            return;
        this._overrides.set(toggle, {
            original: toggle._syncVisibility,
            // The shell defines this on the class, so restoring it as an own
            // property would shadow whatever a later shell puts on the prototype.
            hadOwnSync: Object.hasOwn(toggle, '_syncVisibility'),
            // A rebuilt Quick Settings destroys the old toggle, and a dead
            // one has nothing left to restore
            destroyId: watchDisposal(toggle, () => this._overrides.delete(toggle)),
        });
        toggle._syncVisibility = () => {
            toggle.visible = false;
        };
        toggle.visible = false;
    }

    _restore(toggle) {
        const {original, hadOwnSync, destroyId} = this._overrides.get(toggle);
        this._overrides.delete(toggle);
        toggle.disconnect(destroyId);

        if (hadOwnSync)
            toggle._syncVisibility = original;
        else
            delete toggle._syncVisibility;
        toggle._syncVisibility();
    }
}

// The primary's toggle alone unless the user asked for every monitor, each
// Dash to Panel panel builds a full Quick Settings of its own.
export function backgroundAppsToggles(settings) {
    const everyCopy = settings.get_boolean('show-on-all-monitors');
    const menus = panelCopies()
        .filter(copy => copy.quickSettings && (everyCopy || copy.isPrimary))
        .map(copy => ({copy, toggle: findBackgroundAppsToggle(copy.quickSettings)}));
    const found = menus.filter(({toggle}) => toggle);
    return {found, isComplete: found.length === menus.length};
}

export function findBackgroundAppsToggle(quickSettings) {
    return quickSettings._backgroundApps?.quickSettingsItems[0];
}
