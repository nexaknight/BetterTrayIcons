import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error, warn, warnOnce, clearWarnedOnce} from './src/shared/logging.js';
import {readFileText, isCancelledError} from './src/shared/asyncIo.js';
import {importSettingsFromJSON, probeImportIconPaths, saveSettingsToFile, isOwnSyncSource} from './src/shared/settingsIO.js';
import {clearIds, debounceTo, disconnectSignal, disconnectAll, disposeAll, removeTimer} from './src/shared/lifecycle.js';
import {clearSeenCache, clearVisibleOrder, publishVisibleOrder, userConfigSignature, WHEN_IN_FRONT_MINIMIZE, WHEN_IN_FRONT_NONE} from './src/shared/appConfig.js';
import {clearDetachedMenuManager, clearFlyoutMenus, restoreMenuGrabs} from './src/shell/popupMenus.js';
import {placeIndicatorInPanel, TrayButton} from './src/shell/components/trayButton.js';
import {clearIconCaches} from './src/shell/icons/iconResolver.js';
import {enableLauncherEntries, disableLauncherEntries} from './src/shell/features/launcherEntries.js';
import {clearItemSplits} from './src/shell/identity/itemSplit.js';
import {clearMenuProxyClass} from './src/shell/sni/dbusMenuClient.js';
import {disablePanelCopies, enablePanelCopies} from './src/shell/panelCopies.js';

import {ApiHub} from './src/shell/api/apiHub.js';
import {PanelGuest} from './src/shell/api/panelGuest.js';
import {PanelIndicator} from './src/shell/components/panelIndicator.js';
import {BackgroundAppsHost} from './src/shell/components/backgroundAppsHost.js';
import {TraySink} from './src/shell/components/traySink.js';
import {TrayMirrors} from './src/shell/components/trayMirror.js';
import {SniWatcher} from './src/shell/sni/sniWatcher.js';
import {XEmbedTrayBridge} from './src/shell/xembed/xembedBridge.js';
import {BackgroundApps} from './src/shell/features/backgroundApps.js';
import {BackgroundAppsProxyWatcher} from './src/shell/backgroundAppsProxy/backgroundAppsProxyWatcher.js';
import {loadInterfaces} from './src/shell/dbusCalls.js';
import {DISPLAY_MODE} from './src/const.js';

// Prevents reading a sync file mid-write.
const AUTO_SYNC_DEBOUNCE_MS = 1000;

const AUTO_PUSH_DEBOUNCE_MS = 2000;

const PREFS_WM_CLASS = 'org.gnome.Shell.Extensions';

const LEGACY_MINIMIZE_KEY = 'minimize-when-focused';

export default class BetterTrayIconsExtension extends Extension {
    enable() {
        // Up before the deferred setup below. A peer that looks the moment the
        // shell reports us active would find no api and never knock again.
        this.api = new ApiHub(this, () => this._indicator, () => this._settings);

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
        restoreMenuGrabs();
        disposeAll(this, 'disable', '_xembedBridge', '_sniWatcher');
        this._teardownRenderer();
        disablePanelCopies();
        disposeAll(this, 'destroy', '_traySink');
        disableLauncherEntries();
        clearFlyoutMenus();
        clearDetachedMenuManager();
        clearIconCaches();
        clearSeenCache();
        clearItemSplits();
        clearMenuProxyClass();
        clearWarnedOnce();
        this._settings = null;
    }

    async _realEnable() {
        // A disable and a fresh enable during the load would leave this
        // run's settings handlers behind, firing on a settings object that
        // the next disable already dropped
        const api = this.api;
        try {
            const interfaces = await loadInterfaces(this.dir);
            if (this.api !== api)
                return;

            this._settings = this.getSettings();
            migrateMinimizeWhenFocused(this._settings);

            this._settingsSignals = [];

            this._setupAutoSync();
            this._setupAutoPush();
            this._connectSettings(['enable-auto-sync', 'sync-file-path'], () => {
                this._setupAutoSync();
                this._setupAutoPush();
            });

            enablePanelCopies();
            this._traySink = new TraySink();
            this._buildRenderer();
            this._connectSettings(['display-mode'], () => {
                this._teardownRenderer();
                this._buildRenderer();
            });

            enableLauncherEntries();

            this._sniWatcher = new SniWatcher(interfaces, this._traySink, this._settings);
            this._sniWatcher.enable();

            this._xembedBridge = new XEmbedTrayBridge(this._settings, this._traySink);
            this._xembedBridge.enable();
        } catch (e) {
            // The idle_add puts this outside the shell's own enable error
            // handling, so nothing else would tear down what got built
            // before the throw.
            error(`Fatal Error during enable: ${e.message}`, e);
            this.disable();
        }
    }

    // Only one renderer exists at a time. The Background Apps host stands in
    // for the menu that lists those apps, so the switch hiding it and the
    // proxy icons duplicating it belong to the panel renderer alone.
    _buildRenderer() {
        this._rendererSignals = [];

        if (this._settings.get_string('display-mode') === DISPLAY_MODE.BACKGROUND_APPS) {
            this._backgroundAppsHost = new BackgroundAppsHost(this._settings, () => this.openPreferences());
            this._traySink.setRenderer(this._backgroundAppsHost);
            return;
        }

        this._indicator = new PanelIndicator(this._settings, () => this.openPreferences());
        this._indicator.connect('layout-changed', (_indicator, appIds) => publishVisibleOrder(appIds));
        this._trayButton = new TrayButton(this._indicator);
        placeIndicatorInPanel(this._trayButton, this._settings);
        this._trayMirrors = new TrayMirrors(this._settings, this._trayButton, this._indicator, () => this.openPreferences());

        for (const key of ['tray-order', 'tray-position']) {
            this._rendererSignals.push(this._settings.connect(`changed::${key}`,
                () => placeIndicatorInPanel(this._trayButton, this._settings)));
        }

        this.api.placeForeignItems();
        this._traySink.setRenderer(this._indicator);

        this._backgroundApps = new BackgroundApps(this._settings);
        this._backgroundApps.enable();

        this._backgroundAppsProxyWatcher = new BackgroundAppsProxyWatcher(this._settings, this._indicator);
        this._backgroundAppsProxyWatcher.enable();
    }

    _teardownRenderer() {
        restoreMenuGrabs();
        disconnectAll(this, this._settings, '_rendererSignals');
        disposeAll(this, 'disable', '_backgroundAppsProxyWatcher', '_backgroundApps');
        // Before the sink takes the items back, a wrapper must not outlive its source
        disposeAll(this, 'destroy', '_trayMirrors');
        this._traySink?.setRenderer(null);
        // The indicator first, a parent destroying its children never reaches its
        // own destroy() override.
        disposeAll(this, 'destroy', '_indicator', '_trayButton', '_backgroundAppsHost');
        clearVisibleOrder();
    }

    // A second call throws 'Already showing a prefs dialog' at a reply handler
    // the shell never installed, so the open window has to be raised by hand.
    // Every extension's dialog shares one wm_class, only the title names it.
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

                const iconPaths = await probeImportIconPaths(data, this._syncCancellable);
                if (!this._settings)
                    return;

                // The flag covers import echoes delivered inside apply().
                this._isImporting = true;
                let skipped;
                try {
                    skipped = importSettingsFromJSON(this._settings, data, iconPaths, {merge: true});
                } finally {
                    this._isImporting = false;
                }
                this._noteForeignVersion(data._meta, skipped);
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

    _noteForeignVersion(meta, skipped) {
        const ownVersion = this.metadata['version-name'];
        if (meta?.version === ownVersion)
            return;
        const writer = meta?.version ? `version ${meta.version}` : 'an older version';
        warnOnce('sync-version', `Sync file was written by ${writer}, this is ${ownVersion}. ${skipped} settings from it were skipped.`);
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
                saveSettingsToFile(this._settings, this._settings.get_string('sync-file-path'), {merge: true})
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
}

// The reset makes this a one-shot, a later pick of Per App would otherwise
// flip back to minimize on the next enable.
function migrateMinimizeWhenFocused(settings) {
    if (!settings.get_boolean(LEGACY_MINIMIZE_KEY))
        return;
    if (settings.get_string('when-in-front') === WHEN_IN_FRONT_NONE)
        settings.set_string('when-in-front', WHEN_IN_FRONT_MINIMIZE);
    settings.reset(LEGACY_MINIMIZE_KEY);
}
