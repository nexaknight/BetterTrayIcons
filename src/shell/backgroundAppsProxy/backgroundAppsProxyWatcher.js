import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {warn} from '../../shared/logging.js';
import {fileExists, readFileText, isCancelledError} from '../../shared/fetch.js';
import {clearIds, disconnectAll, disconnectSignal, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed} from '../utils/actor.js';
import {pickAppId} from '../utils/appId.js';
import {forwardDragStateToIndicator} from '../features/dragAndDrop.js';
import {BackgroundAppsProxyIcon, BACKGROUND_PROXY_ID_PREFIX} from './backgroundAppsProxyIcon.js';

// The portal answers under the same string as its bus name and interface.
const BACKGROUND_MONITOR_NAME = 'org.freedesktop.background.Monitor';

const BACKGROUND_MONITOR_PATH = '/org/freedesktop/background/monitor';

// Flatpak writes each running instance's sandbox pid below the user runtime dir.
const FLATPAK_INSTANCE_DIR = '.flatpak';

// One timer coalesces portal changes and tray-icon changes, so it doubles as
// the wait before a proxy icon appears. Measured: the flatpak KeePassXC
// registers its own tray item 1.25 s after launch, and anything near that
// briefly doubles up on apps that do have an icon.
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
            // An SNI icon seeds its app config as it registers, which is the only
            // notice this bridge gets that an app grew a tray icon of its own.
            this._settings.connect('changed::app-configs', () => this._queueRefresh()));
        // The mirror image: an app dropping its own tray icon while it keeps
        // running windowless leaves nothing in the portal list to change, so
        // the icon leaving the panel is the only cue that it now needs a proxy.
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

    // Every candidate comes from the same portal list GNOME shows in Quick
    // Settings, so running while that list is up would show the app twice.
    _sync() {
        if (this._settings.get_boolean('hide-background-apps') &&
            this._settings.get_boolean('enable-background-proxy'))
            this._start();
        else
            this._stop();
    }

    _start() {
        if (this._cancellable)
            return;
        this._cancellable = new Gio.Cancellable();

        // DO_NOT_AUTO_START, so asking for the list never launches the portal.
        // The shell's own background apps menu talks to it the same way.
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

        // A callback overtaken by _stop() never gets here: new_finish rechecks
        // the cancellable (GTask check-cancellable) and throws into the catch.
        this._proxy = proxy;
        // Property reloads after the portal appears arrive here too, so this one
        // handler also covers a portal that was not running yet.
        this._proxySignalId = proxy.connect('g-properties-changed', () => this._queueRefresh());
        // The debounce exists for apps that just launched, not for apps the
        // portal has already listed stably while this bridge was off, so the
        // very first look after (re)enabling skips the wait.
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

    // Keeps its deadline once armed: app-configs can churn faster than the
    // delay, and a resetting debounce would starve the refresh forever.
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

    // Candidates, then the liveness probe, then icons. Building one earlier
    // would flash a second icon beside an app that turns out to have its own,
    // or beside one that is already gone.
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

    // The bridge's own actors stay out, or every proxy icon would read as the
    // reason for its own removal.
    // An actor still identifying has no _appId and covers nothing yet. A
    // portal-listed app can then carry one duplicate icon for a debounce
    // period, until its identity seed queues the refresh that drops it.
    // Waiting instead would starve on items that never identify.
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
            // The key an SNI item of the same flatpak would land on, which is
            // what makes the comparison against live tray icons exact.
            const appId = pickAppId({packaging: {kind: 'flatpak', id: entry.app_id}});
            // Without a desktop entry there is no icon and no name to render.
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
            // The portal goes on listing the app it just lost, so without this
            // the icon the user quit sits there until the portal catches up.
            // The debounce outlasts the teardown, so the probe sees it gone.
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

// The portal keeps listing an app long after it dies, measured at 25 s past a
// flatpak kill, and GNOME shows that ghost too. The instance's own pid file is
// what still tells the two apart.
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
