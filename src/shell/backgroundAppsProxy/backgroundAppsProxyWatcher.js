import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {warn} from '../../shared/logging.js';
import {fileExists, readFileText, isCancelledError} from '../../shared/asyncIo.js';
import {clearIds, disconnectAll, disconnectSignal, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed} from '../disposal.js';
import {pickAppId} from '../identity/appId.js';
import {forwardDragStateToIndicator} from '../features/dragAndDrop.js';
import {BackgroundAppsProxyIcon, BACKGROUND_PROXY_ID_PREFIX} from './backgroundAppsProxyIcon.js';

const BACKGROUND_MONITOR_NAME = 'org.freedesktop.background.Monitor';

const BACKGROUND_MONITOR_PATH = '/org/freedesktop/background/monitor';

// Flatpak writes each running instance's sandbox pid below the user runtime dir.
const FLATPAK_INSTANCE_DIR = '.flatpak';

// One timer coalesces portal and tray-icon changes, so it doubles as the wait
// before a proxy icon appears. The flatpak KeePassXC registers its own tray
// item 1.25 s after launch, and a shorter wait briefly doubles up on it.
const BACKGROUND_PROXY_DEBOUNCE_MS = 4000;

export class BackgroundAppsProxyWatcher {
    constructor(settings, panelIndicator) {
        this._settings = settings;
        this._panelIndicator = panelIndicator;
        this._proxy = null;
        this._cancellable = null;
        this._icons = new Map();
        this._proxySignalId = 0;
        this._settingsSignals = [];
        this._refreshId = 0;
    }

    enable() {
        this._settingsSignals.push(
            this._settings.connect('changed::enable-background-proxy', () => this._sync()),
            this._settings.connect('changed::hide-background-apps', () => this._sync()),
            this._settings.connect('changed::app-configs', () => this._queueRefresh()));
        // An app that drops its own tray icon but keeps running windowless
        // changes nothing in the portal list, so the icon leaving the panel is
        // the only cue that it needs a proxy now.
        this._panelIndicator.setIconsChangedHandler(id => this._onPanelIconRemoved(id));
        this._sync();
    }

    disable() {
        disconnectAll(this, this._settings, '_settingsSignals');
        this._panelIndicator.setIconsChangedHandler(null);
        this._stop();
    }

    _onPanelIconRemoved(id) {
        if (!id.startsWith(BACKGROUND_PROXY_ID_PREFIX))
            this._queueRefresh();
    }

    _sync() {
        const shouldRun = this._settings.get_boolean('hide-background-apps') &&
            this._settings.get_boolean('enable-background-proxy');
        if (shouldRun)
            this._start();
        else
            this._stop();
    }

    _start() {
        if (this._cancellable)
            return;
        this._cancellable = new Gio.Cancellable();

        Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
            BACKGROUND_MONITOR_NAME, BACKGROUND_MONITOR_PATH, BACKGROUND_MONITOR_NAME,
            this._cancellable, (_source, result) => this._onProxyReady(result));
    }

    _onProxyReady(result) {
        let proxy;
        try {
            proxy = Gio.DBusProxy.new_finish(result);
        } catch (e) {
            if (!isCancelledError(e))
                warn(`BackgroundAppsProxyWatcher: monitor proxy failed: ${e.message}`);
            return;
        }

        // A callback overtaken by _stop() never gets here, new_finish rechecks
        // the cancellable (GTask check-cancellable) and throws into the catch.
        this._proxy = proxy;
        this._proxySignalId = proxy.connect('g-properties-changed', () => this._queueRefresh());
        this._queueRefresh(true);
    }

    _stop() {
        clearIds(this, removeTimer, '_refreshId');
        disposeAll(this, 'cancel', '_cancellable');
        disconnectSignal(this, this._proxy, '_proxySignalId');
        this._proxy = null;

        for (const appId of [...this._icons.keys()])
            this._dropIcon(appId);
    }

    _queueRefresh(immediate = false) {
        if (!this._proxy || this._refreshId)
            return;
        if (immediate) {
            this._runRefresh();
            return;
        }
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BACKGROUND_PROXY_DEBOUNCE_MS, () => {
            this._refreshId = 0;
            this._runRefresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _runRefresh() {
        this._refresh().catch(e => {
            if (!isCancelledError(e))
                warn(`BackgroundAppsProxyWatcher: refresh failed: ${e.message}`);
        });
    }

    async _refresh() {
        const cancellable = this._cancellable;
        const covered = this._coveredAppIds();
        const candidates = new Map(
            [...this._portalApps()].filter(([appId]) => !covered.has(appId)));

        const live = await this._filterLive(candidates, cancellable);
        if (cancellable.is_cancelled())
            return;

        for (const appId of [...this._icons.keys()]) {
            if (!live.has(appId))
                this._dropIcon(appId);
        }
        for (const [appId, entry] of live) {
            const icon = this._icons.get(appId);
            if (icon)
                icon.setMessage(entry.message);
            else
                this._addIcon(appId, entry);
        }
    }

    // This watcher's own actors stay out, or every proxy icon would read as
    // the reason for its own removal.
    _coveredAppIds() {
        const mine = new Set([...this._icons.values()].map(icon => icon.actor));
        const covered = new Set();
        for (const actor of this._panelIndicator._icons.values()) {
            if (actor._appId && !mine.has(actor) && !isDisposed(actor))
                covered.add(actor._appId);
        }
        return covered;
    }

    // The portal lists one entry per flatpak instance, so an app running twice
    // arrives twice under one app_id.
    _portalApps() {
        const listed = this._proxy.get_cached_property('BackgroundApps')?.recursiveUnpack() ?? [];
        const apps = new Map();

        for (const entry of listed) {
            if (!entry.app_id || !entry.instance)
                continue;
            const appId = pickAppId({packaging: {kind: 'flatpak', id: entry.app_id}});
            const app = Shell.AppSystem.get_default().lookup_app(`${entry.app_id}.desktop`);
            if (!app)
                continue;

            const known = apps.get(appId);
            if (known) {
                known.instances.push(entry.instance);
                known.message ??= entry.message;
            } else {
                apps.set(appId, {
                    app,
                    flatpakId: entry.app_id,
                    instances: [entry.instance],
                    message: entry.message,
                });
            }
        }
        return apps;
    }

    async _filterLive(apps, cancellable) {
        const runtimeDir = GLib.get_user_runtime_dir();
        const live = new Map();

        await Promise.all([...apps].map(async ([appId, entry]) => {
            const running = await Promise.all(entry.instances.map(
                instance => _instanceIsRunning(runtimeDir, instance, cancellable)));
            if (running.includes(true))
                live.set(appId, entry);
        }));
        return live;
    }

    _addIcon(appId, entry) {
        const icon = new BackgroundAppsProxyIcon(appId, entry, this._settings, {
            onAfterClick: () => this._panelIndicator._handleIconClick(),
            onDragStateChange: forwardDragStateToIndicator(this._panelIndicator),
            onQuit: () => this._queueRefresh(),
        });
        this._icons.set(appId, icon);
        this._panelIndicator.addIcon(icon.id, icon.actor);
    }

    _dropIcon(appId) {
        const icon = this._icons.get(appId);
        this._icons.delete(appId);
        this._panelIndicator.removeIcon(icon.id);
        icon.destroy();
    }
}

// The portal keeps listing an app for up to 25 s after a flatpak kill, so the
// instance's own pid file tells the two apart.
async function _instanceIsRunning(runtimeDir, instance, cancellable) {
    let pid;
    try {
        const pidFile = Gio.File.new_for_path(
            `${runtimeDir}/${FLATPAK_INSTANCE_DIR}/${instance}/pid`);
        pid = (await readFileText(pidFile, cancellable)).trim();
    } catch {
        return false;
    }
    if (!pid)
        return false;
    return fileExists(`/proc/${pid}`, cancellable);
}
