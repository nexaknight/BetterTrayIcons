import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error, warn, clearWarnedOnce} from './src/shared/logging.js';
import {readFileText, isCancelledError} from './src/shared/asyncIo.js';
import {importSettingsFromJSON, probeImportIconPaths, saveSettingsToFile, isOwnSyncSource} from './src/shared/settingsIO.js';
import {clearIds, debounceTo, disconnectSignal, disconnectAll, disposeAll, removeTimer} from './src/shared/lifecycle.js';
import {clearSeenCache, userConfigSignature} from './src/shared/appConfig.js';
import {clearDetachedMenuManager} from './src/shell/popupMenus.js';
import {placeIndicatorInPanel, TrayButton} from './src/shell/components/trayButton.js';
import {clearIconCaches} from './src/shell/icons/iconResolver.js';
import {enableLauncherEntries, disableLauncherEntries} from './src/shell/features/launcherEntries.js';
import {clearItemSplits} from './src/shell/identity/itemSplit.js';
import {accentValueKeeping} from './src/shared/accentColor.js';

import {ApiHub} from './src/shell/api/apiHub.js';
import {PanelGuest} from './src/shell/api/panelGuest.js';
import {PanelIndicator} from './src/shell/components/panelIndicator.js';
import {SniWatcher} from './src/shell/sni/sniWatcher.js';
import {XEmbedTrayBridge} from './src/shell/xembed/xembedBridge.js';
import {BackgroundApps} from './src/shell/features/backgroundApps.js';
import {BackgroundAppsProxyWatcher} from './src/shell/backgroundAppsProxy/backgroundAppsProxyWatcher.js';

// Prevents reading a sync file mid-write.
const AUTO_SYNC_DEBOUNCE_MS = 1000;

const AUTO_PUSH_DEBOUNCE_MS = 2000;

const PREFS_WM_CLASS = 'org.gnome.Shell.Extensions';

const LEGACY_SCHEMA_ID = 'org.gnome.shell.extensions.bettertrayicons.legacy';

export default class BetterTrayIconsExtension extends Extension {
    enable() {
        // Up before the deferred setup below. A peer that looks the moment the
        // shell reports us active would find no api and never knock again.
        this.api = new ApiHub(this, () => this._indicator);

        this.initTranslations();

        // After the domain is bound, the title thunk runs the moment the peer
        // takes the registration.
        this._panelGuest = new PanelGuest();
        this._panelGuest.enable(this);

        // Defer one mainloop iteration so a conflicting tray extension's
        // teardown can release the SNI name and X11 tray selection first.
        this._enableTimeoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._enableTimeoutId = 0;
            this._realEnable();
            return GLib.SOURCE_REMOVE;
        });
    }

    _realEnable() {
        try {
            this._settings = this.getSettings();
            _runMigrations(this._settings, this.getSettings(LEGACY_SCHEMA_ID));

            this._settingsSignals = [];

            this._setupAutoSync();
            this._setupAutoPush();
            this._connectSettings(['enable-auto-sync', 'sync-file-path'], () => {
                this._setupAutoSync();
                this._setupAutoPush();
            });

            this._indicator = new PanelIndicator(this._settings, () => this.openPreferences());
            this._trayButton = new TrayButton(this._indicator);
            placeIndicatorInPanel(this._trayButton, this._settings);

            this._connectSettings(['tray-order', 'tray-position'], () => {
                placeIndicatorInPanel(this._trayButton, this._settings);
            });

            enableLauncherEntries();

            this._sniWatcher = new SniWatcher(this.dir, this._indicator, this._settings);
            this._sniWatcher.enable();

            this._xembedBridge = new XEmbedTrayBridge(this._settings, this._indicator);
            this._xembedBridge.enable();

            this._backgroundApps = new BackgroundApps(this._settings);
            this._backgroundApps.enable();

            this._backgroundAppsProxyWatcher = new BackgroundAppsProxyWatcher(this._settings, this._indicator);
            this._backgroundAppsProxyWatcher.enable();
        } catch (e) {
            // The idle_add puts this outside the shell's own enable error
            // handling, so nothing else would tear down what got built
            // before the throw.
            error(`Fatal Error during enable: ${e.message}`, e);
            this.disable();
        }
    }

    // The service throws 'Already showing a prefs dialog' on a second call and
    // the shell fires that call without a reply handler, so triggering the
    // action again while the window was open did nothing at all. Every
    // extension's dialog shares one wm_class and carries no app id, which
    // leaves the title as the only thing naming the owner.
    openPreferences() {
        const open = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .find(w => w.get_wm_class() === PREFS_WM_CLASS && w.get_title() === this.metadata.name);
        if (open)
            Main.activateWindow(open);
        else
            super.openPreferences();
    }

    _setupAutoSync() {
        disconnectSignal(this, this._fileMonitor, '_fileMonitorSignalId');
        disposeAll(this, 'cancel', '_fileMonitor', '_syncCancellable');
        clearIds(this, removeTimer, '_syncDebounceId');

        const path = this._syncTarget();
        if (!path)
            return;

        try {
            const file = Gio.File.new_for_path(path);
            this._fileMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitorSignalId = this._fileMonitor.connect('changed', (_monitor, f, _other, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CHANGED || eventType === Gio.FileMonitorEvent.CREATED)
                    this._queueSyncImport(f);
            });
        } catch (e) {
            warn(`Failed to setup auto-sync monitor: ${e.message}`);
        }
    }

    _queueSyncImport(file) {
        debounceTo(this, '_syncDebounceId', AUTO_SYNC_DEBOUNCE_MS, () => {
            disposeAll(this, 'cancel', '_syncCancellable');
            this._syncCancellable = new Gio.Cancellable();

            readFileText(file, this._syncCancellable).then(async text => {
                const data = JSON.parse(text);

                // Skip changes this host wrote itself to avoid sync loops.
                if (isOwnSyncSource(data._meta))
                    return;

                // Probe the icon paths before the flag goes up. They can sit on
                // a network mount, and this runs on the shell's main loop.
                const iconPaths = await probeImportIconPaths(data, this._syncCancellable);
                if (!this._settings)
                    return;

                // The flag covers import echoes delivered inside apply().
                this._isImporting = true;
                try {
                    importSettingsFromJSON(this._settings, data, iconPaths, {merge: true});
                } finally {
                    this._isImporting = false;
                }
                // The change echo can land after the flag drops. Re-stamp by
                // hand, or the next app-configs write counts the imported
                // changes as the user's and pushes a file we just read.
                this._lastUserConfig = userConfigSignature(this._settings);
            }).catch(e => {
                if (!isCancelledError(e))
                    warn(`Auto-sync import failed: ${e.message}`);
            });
        });
    }

    _setupAutoPush() {
        disconnectSignal(this, this._settings, '_autoPushSignalId');
        clearIds(this, removeTimer, '_autoPushDebounceId');

        if (!this._syncTarget())
            return;

        this._lastUserConfig = userConfigSignature(this._settings);

        this._autoPushSignalId = this._settings.connect('changed', (_s, key) => {
            if (key === 'sync-file-path' || key === 'enable-auto-sync')
                return;
            if (this._isImporting)
                return;
            // The sync metadata moves in lockstep with app-configs, so a
            // metadata-only write (a tombstone pruned on migration) must not
            // push on its own.
            if ((key === 'app-configs' || key === 'app-config-sync-meta') && !this._userConfigMoved())
                return;

            debounceTo(this, '_autoPushDebounceId', AUTO_PUSH_DEBOUNCE_MS, () => {
                saveSettingsToFile(this._settings, this._settings.get_string('sync-file-path'))
                    .catch(e => warn(`Auto-push failed: ${e.message}`));
            });
        });
    }

    _syncTarget() {
        const path = this._settings.get_string('sync-file-path');
        return this._settings.get_boolean('enable-auto-sync') && path ? path : null;
    }

    _userConfigMoved() {
        const next = userConfigSignature(this._settings);
        if (next === this._lastUserConfig)
            return false;
        this._lastUserConfig = next;
        return true;
    }

    _connectSettings(keys, handler) {
        for (const key of keys)
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, handler));
    }

    disable() {
        // Modules survive a disable, so a peer holding this would keep getting
        // a destroyed actor.
        this.api?.destroy();
        this.api = null;

        this._panelGuest?.disable();
        this._panelGuest = null;

        clearIds(this, removeTimer, '_enableTimeoutId', '_syncDebounceId', '_autoPushDebounceId');
        disconnectSignal(this, this._settings, '_autoPushSignalId');
        disconnectAll(this, this._settings, '_settingsSignals');
        disconnectSignal(this, this._fileMonitor, '_fileMonitorSignalId');

        disposeAll(this, 'cancel', '_fileMonitor', '_syncCancellable');
        disposeAll(this, 'disable', '_backgroundAppsProxyWatcher', '_backgroundApps', '_xembedBridge', '_sniWatcher');
        // The indicator first, a parent destroying its children never reaches its
        // own destroy() override. The button then takes itself out of
        // Main.panel.statusArea through the destroy handler the panel put on it.
        disposeAll(this, 'destroy', '_indicator', '_trayButton');
        disableLauncherEntries();
        clearDetachedMenuManager();
        clearIconCaches();
        clearSeenCache();
        clearItemSplits();
        clearWarnedOnce();
        this._settings = null;
    }
}

// Removed keys still hold whatever an older version wrote. The legacy schema
// sits on the same dconf path, so these can still read them.
function _runMigrations(settings, legacy) {
    _migrateTrayIconPadding(settings, legacy);
    _migrateAccentColors(settings, legacy);
}

function _migrateTrayIconPadding(settings, legacy) {
    const newKeysUntouched = ['icon-padding-top', 'icon-padding-bottom', 'icon-padding-left', 'icon-padding-right']
        .every(key => settings.get_user_value(key) === null);
    const oldKeysCustomized = legacy.get_user_value('icon-padding-horizontal') !== null ||
        legacy.get_user_value('icon-padding-vertical') !== null;
    if (!newKeysUntouched || !oldKeysCustomized)
        return;

    const horizontal = legacy.get_int('icon-padding-horizontal');
    const vertical = legacy.get_int('icon-padding-vertical');
    settings.set_int('icon-padding-left', horizontal);
    settings.set_int('icon-padding-right', horizontal);
    settings.set_int('icon-padding-top', vertical);
    settings.set_int('icon-padding-bottom', vertical);
}

function _migrateAccentColors(settings, legacy) {
    for (const accentKey of legacy.settings_schema.list_keys()) {
        if (!accentKey.endsWith('-use-accent-color') || legacy.get_user_value(accentKey) === null)
            continue;

        if (legacy.get_boolean(accentKey)) {
            const colorKey = accentKey.replace(/use-accent-color$/, 'color');
            settings.set_string(colorKey, accentValueKeeping(settings.get_string(colorKey)));
        }
        legacy.reset(accentKey);
    }
}
