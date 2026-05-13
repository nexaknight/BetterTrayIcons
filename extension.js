import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error, warn} from './src/shared/logging.js';
import {importSettingsFromJSON, saveSettingsToFile} from './src/shared/settingsIO.js';
import {clearIds, disconnectSignal, disconnectAll, disposeAll, removeTimer} from './src/shared/lifecycle.js';
import {placeIndicatorInPanel} from './src/shell/utils/actor.js';

import {PanelIndicator} from './src/shell/panelIndicator.js';
import {SniWatcher} from './src/shell/sniWatcher.js';
import {XEmbedTrayBridge} from './src/shell/xembedBridge.js';
import {AUTO_SYNC_DEBOUNCE_MS, AUTO_PUSH_DEBOUNCE_MS, AUTO_PUSH_GUARD_AFTER_IMPORT_MS} from './src/const.js';

export default class BetterTrayIconsExtension extends Extension {
    enable() {
        this.initTranslations();

        // Defer init to avoid races with other extensions during shell startup.
        this._enableTimeoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._enableTimeoutId = 0;
            this._realEnable();
            return GLib.SOURCE_REMOVE;
        });
    }

    _realEnable() {
        try {
            this._settings = this.getSettings();

            this._settingsSignals = [];

            this._setupAutoSync();
            this._setupAutoPush();
            this._connectSettings(['enable-auto-sync', 'sync-file-path'], () => {
                this._setupAutoSync();
                this._setupAutoPush();
            });

            this._indicator = new PanelIndicator(this._settings, () => this.openPreferences());
            placeIndicatorInPanel(this._indicator, this._settings);

            this._connectSettings(['tray-order', 'tray-position'], () => {
                placeIndicatorInPanel(this._indicator, this._settings);
            });

            this._manager = new SniWatcher(this.dir, this._indicator, this._settings);
            this._manager.enable();

            // XEmbed bridge for legacy tray icons (Wine, classic X11).
            // The bridge gates itself on `enable-wine-support`.
            this._xembedBridge = new XEmbedTrayBridge(this._settings, this._indicator);
            this._xembedBridge.enable();
        } catch (e) {
            error(`Fatal Error during enable: ${e.message}`, e);
        }
    }

    _setupAutoSync() {
        disposeAll(this, 'cancel', '_fileMonitor', '_syncCancellable');
        clearIds(this, removeTimer, '_syncDebounceId');

        const enabled = this._settings.get_boolean('enable-auto-sync');
        const path = this._settings.get_string('sync-file-path');

        if (!enabled || !path)
            return;

        try {
            const file = Gio.File.new_for_path(path);
            this._fileMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitor.connect('changed', (_monitor, f, _other, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CHANGED || eventType === Gio.FileMonitorEvent.CREATED)
                    this._queueSyncImport(f);
            });
        } catch (e) {
            warn(`Failed to setup auto-sync monitor: ${e.message}`);
        }
    }

    _queueSyncImport(file) {
        clearIds(this, removeTimer, '_syncDebounceId');

        // Debounce so the read happens after the writer is done, not mid-write.
        this._syncDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_SYNC_DEBOUNCE_MS, () => {
            this._syncDebounceId = 0;

            // Cancellable lets disable() abort the read before it touches
            // a nulled `this._settings`.
            disposeAll(this, 'cancel', '_syncCancellable');
            this._syncCancellable = new Gio.Cancellable();

            file.load_contents_async(this._syncCancellable, (obj, res) => {
                try {
                    const [success, contents] = obj.load_contents_finish(res);
                    if (success && this._settings) {
                        const data = JSON.parse(new TextDecoder().decode(contents));

                        // Skip changes this host wrote itself to avoid sync loops.
                        if (data._meta && data._meta.source === GLib.get_host_name())
                            return;

                        this._lastImportAt = Date.now();
                        importSettingsFromJSON(this._settings, data);
                    }
                } catch (e) {
                    if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    warn(`Auto-sync import failed: ${e.message}`);
                }
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupAutoPush() {
        disconnectSignal(this, this._settings, '_autoPushSignalId');
        clearIds(this, removeTimer, '_autoPushDebounceId');

        const enabled = this._settings.get_boolean('enable-auto-sync');
        const path = this._settings.get_string('sync-file-path');
        if (!enabled || !path)
            return;

        this._autoPushSignalId = this._settings.connect('changed', (_s, key) => {
            if (key === 'sync-file-path' || key === 'enable-auto-sync')
                return;
            if (this._lastImportAt && Date.now() - this._lastImportAt < AUTO_PUSH_GUARD_AFTER_IMPORT_MS)
                return;

            clearIds(this, removeTimer, '_autoPushDebounceId');
            this._autoPushDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_PUSH_DEBOUNCE_MS, () => {
                this._autoPushDebounceId = 0;
                try {
                    saveSettingsToFile(this._settings, this._settings.get_string('sync-file-path'));
                } catch (e) {
                    warn(`Auto-push failed: ${e.message}`);
                }
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _connectSettings(keys, handler) {
        for (const key of keys)
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, handler));
    }

    disable() {
        clearIds(this, removeTimer, '_enableTimeoutId', '_syncDebounceId', '_autoPushDebounceId');
        disconnectSignal(this, this._settings, '_autoPushSignalId');
        disconnectAll(this, this._settings, '_settingsSignals');

        disposeAll(this, 'cancel', '_fileMonitor', '_syncCancellable');
        // SniWatcher and XEmbedTrayBridge use .disable() rather than .destroy().
        disposeAll(this, 'disable', '_xembedBridge', '_manager');
        disposeAll(this, 'destroy', '_indicator');
        this._settings = null;
    }
}
