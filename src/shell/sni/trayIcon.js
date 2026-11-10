import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {warn, warnOnce} from '../../shared/logging.js';
import {
    configRenderDelta,
    getAppConfigMap,
    getAppConfigValue,
    setAppConfigValue,
    updateAppConfig,
    reseedIfForgotten,
    formatAppName,
    isVolatileIconName,
    unreadBadgeEnabled,
    SCROLL_ACTION_DEFAULT,
} from '../../shared/appConfig.js';
import {clearIds, debounceTo, disconnectSignal, disconnectAll, disposeAll, removeTimer, ruleDispatcher} from '../../shared/lifecycle.js';
import {getItemAddress, refreshPropertyOnProxy, refreshStringOnProxy} from '../dbusCalls.js';
import {identifyApp, resolveTrayIcon} from '../icons/iconResolver.js';
import {pickDisplayTitle} from '../identity/appId.js';
import {forgetItem} from '../identity/itemSplit.js';
import {scopeDesktopId} from '../identity/packaging.js';
import {attachStatusIcon, setBadgeContent, setIconContent} from '../icons/iconContent.js';
import {connectColorSetChanges, refreshTrayStyle, syncHoverStyle} from '../trayStyle.js';
import {connectSurfaceChanges} from '../actorPlacement.js';
import {isDisposed, trackDisposal} from '../disposal.js';
import {createPanelMenu, menuAnchorFor, menuManagerFor, panelMenuManagerFor, destroyMenuSafely, keepsOverflowOpen, releaseMenuGrabs, restoreMenuGrabs, restoreMenuGrabsOnFocus, POPUP_ANIMATION_NONE} from '../popupMenus.js';
import {addUnreadListener, inFrontActionFor, raiseApp, runningApp, unreadTargets} from '../features/launcherEntries.js';
import {DBusMenuClient} from './dbusMenuClient.js';
import {RemoteMenuPlacement} from './remoteMenuPlacement.js';
import {bindTrayClicks} from '../features/clickController.js';
import {DRAG_SETTING_KEYS, setupIconDragSource, syncDragEnabled} from '../features/dragAndDrop.js';
import {applyTitle, createTrayActor, syncTooltip} from '../features/tooltip.js';
import {TRAY_STYLE_KEYS} from '../../const.js';

const ICON_UPDATE_DELAY_MS = 20;

// Each resolve costs several D-Bus gets plus a possible PNG encode and
// cache write, so animated icons are capped at 4 updates per second.
const ICON_UPDATE_MIN_INTERVAL_MS = 250;

const TITLE_UPDATE_DEBOUNCE_MS = 300;

const MENU_REOPEN_GUARD_MS = 200;

const MENU_DROP_DELAY_MS = 0;

const SCROLL_ACTION_FORWARD = 'forward';

// Never launched, the activation token only needs an app info with a name
const PLACEHOLDER_COMMAND_LINE = 'true';

// The color keys decide the tint that goes into a symbolic icon's bytes,
// which no restyle can change.
const ICON_RESOLVE_KEYS = Object.freeze([
    'icon-size',
    'enable-symbolic-icons',
    'icon-color',
    'enable-custom-icon-style',
]);

export class TrayIcon {
    constructor(menuInterfaceXml, busName, objectPath, settings, proxy, onReady, onDestroy, onCloseMenu, onDragStateChange = null, onStatusChange, onShownIconChange) {
        this._menuInterfaceXml = menuInterfaceXml;
        this.busName = busName;
        this._objectPath = objectPath;
        this._settings = settings;
        this._proxy = proxy;
        this._onReady = onReady;
        this._onDestroy = onDestroy;
        this._onCloseMenu = onCloseMenu;
        this._onDragStateChange = onDragStateChange;
        this._onStatusChange = onStatusChange;
        this._onShownIconChange = onShownIconChange;

        this.id = getItemAddress(busName, objectPath);
        this.appId = null;
        this.actor = null;
        this._isDestroyed = false;

        this._updateDeferId = 0;
        this._lastUpdateRun = 0;
        this._titleDeferId = 0;
        this._settingsConnectId = 0;
        this._configSig = null;
        this._pixmapHash = null;
        this._updateGen = 0;
        this._titleGen = 0;
        this._unreadUnsub = null;

        this._proxySignals = [];
        this._gObjectSignals = [];

        this._menu = null;
        this._menuDropId = 0;
        this._activateId = 0;
        this._scopeDesktopId = null;
        this._acceptsActivationToken = true;
        this._menuClient = null;
        this._remoteMenuPlacement = null;
        this._tooltip = null;
        this._clickController = null;
        this._lastClose = {anchor: null, time: 0};
        this._scrollCarryX = 0;
        this._scrollCarryY = 0;
        this._acceptsScroll = true;

        this._setup();
    }

    async _setup() {
        this._connectProxySignals();
        this._connectPropertyChanges();
        this._connectSettingsChanges();
        this._createUI();

        try {
            const identity = await identifyApp(this._proxy, this.busName, this._settings,
                appId => this._rekey(appId));
            this._scopeDesktopId = await scopeDesktopId(identity.pid);
            if (this._isDestroyed) {
                forgetItem(this.id);
                return;
            }

            // A sibling can trigger the split while this call is still settling,
            // and its rekey already holds the id this item ends up on.
            this.appId ??= identity.appId;
            this._identitySeed = identity.seed;
            this._pid = identity.pid;
            this._packaging = identity.packaging;
            this._processName = identity.processName;
            this.actor._appId = this.appId;

            // A proxied app that grew a real tray icon keeps its proxy flag
            // forever, updateAppConfig never removes fields. Stale, it keeps
            // the Background badge and the proxy dialog variant alive.
            if (getAppConfigValue(this._settings, this.appId, 'is_background_proxy') === true)
                setAppConfigValue(this._settings, this.appId, 'is_background_proxy', null);

            this._draggable._appId = this.appId;

            // Prime the signature so the change handler compares against
            // the state this first render is about to use.
            this._configChanged();
            this._applyStoredConfig();
            await this._updateIcon();
            if (this._isDestroyed)
                return;

            this._swallow(this._updateTitle(), 'updateTitle');
            this._swallow(this._updateMenuPath(), 'updateMenuPath');

            this._onReady(this.id, this.actor);
        } catch (e) {
            warn(`TrayIcon: Ident/Update failed: ${e.message}`);
        }
    }

    // Only the id moves, the carry-over write that follows arrives as an
    // app-configs change and the rule for that key re-renders.
    _rekey(appId) {
        this.appId = appId;
        if (this.actor)
            this.actor._appId = appId;
        if (this._draggable)
            this._draggable._appId = appId;
    }

    _connectProxySignals() {
        const handlers = {
            NewIcon: () => this._queueUpdate(),
            NewAttentionIcon: () => this._queueUpdate(),
            NewOverlayIcon: () => this._queueUpdate(),
            NewStatus: () => this._queueUpdate(),
            NewTitle: () => this._queueTitleUpdate(),
        };
        for (const [signal, handler] of Object.entries(handlers)) {
            this._proxySignals.push(
                this._proxy.connectSignal(signal, this._guarded(handler))
            );
        }
    }

    _connectPropertyChanges() {
        this._gObjectSignals.push(
            this._proxy.connect('g-properties-changed', this._guarded((_p, changed) => {
                const unpacked = changed.deep_unpack();
                if (unpacked['Menu'])
                    this._swallow(this._updateMenuPath(), 'updateMenuPath');
                if (unpacked['IconName'] || unpacked['IconPixmap'] || unpacked['Status'])
                    this._queueUpdate();
            }))
        );
    }

    _connectSettingsChanges() {
        const rules = [
            {
                match: key => key === 'app-configs', run: () => {
                    reseedIfForgotten(this._settings, this.appId, this._identitySeed);
                    if (!this._configChanged())
                        return;
                    this._applyStoredConfig();
                    this._queueUpdate();
                    this._swallow(this._updateTitle(), 'updateTitle');
                },
            },
            {match: key => TRAY_STYLE_KEYS.includes(key), run: () => refreshTrayStyle(this.actor, this._iconActor, this._settings)},
            {match: key => ICON_RESOLVE_KEYS.includes(key), run: () => this._queueUpdate()},
            {match: key => key === 'enable-tooltips', run: () => this._swallow(this._updateTitle(), 'updateTitle')},
            {match: key => DRAG_SETTING_KEYS.includes(key), run: () => syncDragEnabled(this._draggable, this._settings)},
        ];

        this._settingsConnectId = this._settings.connect(
            'changed',
            this._guarded(ruleDispatcher(rules))
        );

        this._colorSetWatch = connectColorSetChanges(this._settings,
            this._guarded(() => this._applyColorSet()));
    }

    _applyColorSet() {
        refreshTrayStyle(this.actor, this._iconActor, this._settings);
        this._queueUpdate();
    }

    _configChanged() {
        if (!this.appId)
            return true;
        const {sig, changed} = configRenderDelta(this._settings, this.appId, this._configSig);
        this._configSig = sig;
        return changed;
    }

    _guarded(fn) {
        return (...args) => {
            if (!this._isDestroyed)
                fn.apply(this, args);
        };
    }

    _swallow(promise, label) {
        promise.catch(e => warn(`${label} failed for ${this.id}: ${e.message}`));
    }

    // A resetting debounce would starve on apps that emit NewIcon faster than
    // the delay, freezing the icon, and would run the full pipeline per frame
    // for slower animations.
    _queueUpdate() {
        if (this._updateDeferId)
            return;

        const sinceLast = (GLib.get_monotonic_time() - this._lastUpdateRun) / 1000;
        const delay = Math.max(ICON_UPDATE_DELAY_MS, ICON_UPDATE_MIN_INTERVAL_MS - sinceLast);

        this._updateDeferId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateDeferId = 0;
            this._lastUpdateRun = GLib.get_monotonic_time();
            this._swallow(this._updateIcon(), 'updateIcon');
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueTitleUpdate() {
        if (this._titleDeferId)
            return;

        this._titleDeferId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TITLE_UPDATE_DEBOUNCE_MS, () => {
            this._titleDeferId = 0;
            this._swallow(this._updateTitle(), 'updateTitle');
            return GLib.SOURCE_REMOVE;
        });
    }

    _createUI() {
        const {actor, tooltip} = createTrayActor(this._settings);
        this.actor = actor;
        this._tooltip = tooltip;

        this._iconActor = attachStatusIcon(this.actor);
        // The resolved pixmap or SVG carries a fixed pixel size, so a new
        // monitor scale needs a fresh resolve.
        this._iconActor.connect('resource-scale-changed', this._guarded(() => this._queueUpdate()));

        connectSurfaceChanges(this.actor, this._guarded(() => this._applyColorSet()));

        this.actor.connect('notify::hover', this._guarded(() => {
            syncHoverStyle(this.actor);

            if (this.actor.hover && !this._tooltip._label.text)
                this._swallow(this._updateTitle(), 'updateTitle');
            syncTooltip(this.actor, this._tooltip, this._settings);
        }));

        this._draggable = setupIconDragSource({
            actor: this.actor,
            appId: this.appId,
            settings: this._settings,
            tooltip: this._tooltip,
            onForwardedDragStateChange: this._onDragStateChange,
        });

        // A Background Apps row runs the same paths as a click on the icon.
        // A mirror on another monitor's panel passes its own item, the menu
        // and the popup that closes after the click are that item's.
        this.actor._trayAction = (action, _event, anchor) => this._executeAction(action, anchor);
        this.actor._trayFillMenu = menu => this._fillMenu(menu);
        this.actor._trayRestyle = () => refreshTrayStyle(this.actor, this._iconActor, this._settings);

        this._clickController = bindTrayClicks(this.actor, this._settings, this._draggable,
            action => this._executeAction(action));

        this.actor.connect('scroll-event', (_actor, event) => this._onScroll(event));

        refreshTrayStyle(this.actor, this._iconActor, this._settings);
    }

    // Clutter sends a smooth and a discrete event per notch, reading both
    // would double every step. The discrete one still stops here, a list
    // holding the icon would scroll on it.
    _onScroll(event) {
        const isForwarding = this._acceptsScroll && this._scrollAction() === SCROLL_ACTION_FORWARD;
        if (!isForwarding)
            return Clutter.EVENT_PROPAGATE;
        if (event.get_scroll_direction() !== Clutter.ScrollDirection.SMOOTH)
            return Clutter.EVENT_STOP;

        const [dx, dy] = event.get_scroll_delta();
        this._scrollCarryX = this._sendScroll(this._scrollCarryX + dx, 'horizontal');
        this._scrollCarryY = this._sendScroll(this._scrollCarryY + dy, 'vertical');
        return Clutter.EVENT_STOP;
    }

    // Most items take Scroll and do nothing with it, so only the user knows
    // which app uses the wheel. The app's own pick beats the global one.
    _scrollAction() {
        const ownAction = getAppConfigValue(this._settings, this.appId, 'scroll_action', SCROLL_ACTION_DEFAULT);
        return ownAction === SCROLL_ACTION_DEFAULT ? this._settings.get_string('tray-action-scroll') : ownAction;
    }

    _sendScroll(accumulated, orientation) {
        const steps = Math.trunc(accumulated);
        if (!steps)
            return accumulated;

        this._proxy.ScrollRemote(steps, orientation, (_result, err) => {
            if (!err)
                return;
            warnOnce(`Scroll:${this.appId}`, `${this.id} does not answer Scroll: ${err.message}`);
            if (err.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD))
                this._acceptsScroll = false;
        });
        return accumulated - steps;
    }

    _executeAction(action, anchor = this.actor) {
        // 'drag-drop' is a config marker, not a click action. The drag starts
        // on mouse motion, so there's nothing to fire on long-press release.
        if (this._isDestroyed || action === 'nothing' || action === 'drag-drop')
            return;

        switch (action) {
        case 'activate':
            this._activate(anchor);
            break;
        case 'secondary':
            this._fireAndClose('SecondaryActivateRemote', anchor);
            break;
        case 'menu': {
            // The click that closes a popup also fires here, which would
            // toggle it right back on. A click on another panel is a new one.
            const isClosingClick = this._lastClose.anchor === anchor &&
                GLib.get_monotonic_time() - this._lastClose.time < MENU_REOPEN_GUARD_MS * GLib.TIME_SPAN_MILLISECOND;
            if (!isClosingClick)
                this._contextMenu(anchor);
            break;
        }
        }
    }

    // Activate on an item whose window sits on another workspace did nothing
    // visible, so raise through the shell instead. A focused app still gets
    // the Activate, tray apps toggle their window on it.
    _activate(anchor) {
        const app = runningApp({
            pid: this._pid,
            appId: this.appId,
            packagingKind: getAppConfigValue(this._settings, this.appId, 'packaging'),
            scopeDesktopId: this._scopeDesktopId,
        });
        if (!app) {
            this._releaseMenuFocus(anchor);
            debounceTo(this, '_activateId', 0, () => this._fireAndClose('ActivateRemote', anchor, null, true));
            return;
        }
        if (app !== Shell.WindowTracker.get_default().focus_app) {
            this._onCloseMenu(anchor);
            raiseApp(app);
            return;
        }
        const inFrontAction = inFrontActionFor(this._settings, this.appId);
        if (inFrontAction) {
            this._onCloseMenu(anchor);
            inFrontAction(app);
            return;
        }
        this._releaseMenuFocus(anchor);
        debounceTo(this, '_activateId', 0, () => this._fireAndClose('ActivateRemote', anchor, app));
    }

    // The app gets the keyboard from the popup grab, without it a toggling app
    // reads the Activate as show and a new window cannot take focus. Quick
    // Settings holds its item menus beside its box, not in it.
    _releaseMenuFocus(anchor) {
        const managers = anchor._trayGrabManagers?.() ?? [Main.panel.menuManager];
        if (!managers[0].activeMenu?.actor.contains(anchor))
            return;
        releaseMenuGrabs(managers);
    }

    // Items without Activate answer UnknownMethod, the click did nothing
    // and closing would gain nothing, so the close waits for the reply.
    _fireAndClose(method, anchor, app = null, opensWindow = false) {
        this._provideActivationToken(app);
        this._proxy[method](0, 0, (_result, err) => {
            // A closing menu pops its grab, so it has to be back before the
            // close. Only a menu that stays open waits for the new window.
            const awaitsWindow = opensWindow && !err && keepsOverflowOpen(this._settings);
            if (awaitsWindow)
                restoreMenuGrabsOnFocus();
            else
                restoreMenuGrabs();
            if (this._isDestroyed)
                return;
            const isFailureKept = err && this._settings.get_boolean('keep-popup-on-failed-click');
            if (isFailureKept) {
                warnOnce(`${method}:${this.appId}`,
                    `${this.id} does not answer ${method}, leaving the popup open: ${err.message}`);
            }
            // With keep-popup-after-click this reopens the popup the
            // focused-app path closed before the Activate.
            // A mirror taken down meanwhile leaves no popup to close
            if (isDisposed(anchor) || (isFailureKept && !keepsOverflowOpen(this._settings)))
                return;
            this._onCloseMenu(anchor);
        });
    }

    // On Wayland an app can only focus the window it shows with an activation
    // token. Bus calls stay in order, so the token lands before the Activate.
    _provideActivationToken(app) {
        if (!this._acceptsActivationToken)
            return;

        const context = global.create_app_launch_context(global.display.get_current_time_roundtrip(), -1);
        // Mutter 49.0 reads the app info's name without a null check and the
        // shell segfaults, so the token always gets one
        const appInfo = app?.get_app_info() ??
            Gio.AppInfo.create_from_commandline(PLACEHOLDER_COMMAND_LINE, this.id, Gio.AppInfoCreateFlags.NONE);
        const token = context.get_startup_notify_id(appInfo, []);
        this._proxy.ProvideXdgActivationTokenRemote(token, (_result, err) => {
            if (!err)
                return;
            context.launch_failed(token);
            if (err.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD))
                this._acceptsActivationToken = false;
        });
    }

    // Runs for an unidentified item too, it has no stored config but the
    // Passive rule still decides whether it shows.
    _applyStoredConfig() {
        const isHidden = getAppConfigValue(this._settings, this.appId, 'is_hidden', false);
        this.actor.visible = !isHidden && !this.actor._isPassive;
    }

    async _updateIcon() {
        if (this._isDestroyed)
            return;

        // _queueUpdate guards against a second timer, not a second run.
        // Without a generation the slower of two resolve roundtrips wins and
        // parks the icon on a stale status or pixmap.
        const generation = ++this._updateGen;

        const {gicon, iconName, emoji, detected, status, pixmapHash, unchanged, badge, shownIcon} = await resolveTrayIcon(
            this._proxy,
            this._settings,
            this.appId,
            this._pixmapHash,
            {pid: this._pid, packaging: this._packaging},
            this._iconTint()
        );

        if (this._isDestroyed || generation !== this._updateGen)
            return;

        this._pixmapHash = pixmapHash;

        const entry = this.appId ? getAppConfigMap(this._settings)[this.appId] : null;
        this._syncUnreadListener(entry);

        // The spec calls Passive an idle status that visualizations are likely
        // to hide, and apps like KDE Connect park there instead of unregistering.
        const wasPassive = this.actor._isPassive;
        this.actor._isPassive = status === 'Passive';
        if (wasPassive !== this.actor._isPassive) {
            this._applyStoredConfig();
            this._onStatusChange();
        }

        if (!unchanged) {
            setIconContent(this._iconActor, {gicon, iconName: iconName || 'image-missing', emoji});
            this._publishShownIcon(shownIcon ?? entry?.cached_icon_path, detected.iconName);
        }
        // Also on unchanged frames, a count change reuses the cached pixmap.
        setBadgeContent(this.actor, this._settings, badge,
            badge ? entry?.badge_style : null);

        // Alert names are not the calm baseline and volatile names would
        // rewrite the blob per frame. A missing baseline is seeded even during
        // an alert, apps booting in attention state would never get one.
        const isCalmOrFirstSeed = !detected.hasAlert || detected.baselineMissing;
        const isStableName = !!detected.iconName && !isVolatileIconName(detected.iconName);
        if (this.appId && isCalmOrFirstSeed && isStableName) {
            const updateData = {detected_icon: detected.iconName};
            if (detected.iconThemePath)
                updateData.icon_theme_path = detected.iconThemePath;
            updateAppConfig(this._settings, this.appId, updateData);
        }
    }

    // A pixmap has no name, so it goes out as the cached copy the shell keeps
    // for the prefs anyway.
    _publishShownIcon(icon, state) {
        const shown = icon ? {icon, state: state ?? null} : null;
        if (JSON.stringify(shown) === JSON.stringify(this.actor._shownIcon ?? null))
            return;
        this.actor._shownIcon = shown;
        this._onShownIconChange();
    }

    // St resolves the accent keyword and the panel default that settings
    // alone cannot, so a tint matches a themed icon. Off the stage the node
    // answers with its own foreground, which would tint the first frame black.
    _iconTint() {
        if (!this._iconActor.get_stage())
            return null;
        return this._iconActor.get_theme_node().get_foreground_color().to_string();
    }

    // Registered only while the badge is on, an idle listener would turn
    // every LauncherEntry emission into a full resolve.
    _syncUnreadListener(entry) {
        if (!unreadBadgeEnabled(entry)) {
            this._unreadUnsub?.();
            this._unreadUnsub = null;
            return;
        }
        this._unreadUnsub ??= addUnreadListener(unreadTargets({
            pid: this._pid,
            appId: this.appId,
            packagingKind: entry?.packaging,
        }), this._guarded(() => this._queueUpdate()));
    }

    async _updateTitle() {
        if (this._isDestroyed)
            return;

        const generation = ++this._titleGen;
        let title = getAppConfigValue(this._settings, this.appId, 'custom_title');
        if (!title) {
            const raw = await refreshStringOnProxy(this._proxy, 'Title');
            if (this._isDestroyed || generation !== this._titleGen)
                return;

            // A rename can land while the proxy roundtrip is in flight.
            const freshCustom = getAppConfigValue(this._settings, this.appId, 'custom_title');
            title = freshCustom ?? pickDisplayTitle({
                title: raw, processName: this._processName, appId: this.appId, busName: this.busName,
            });

            // The prefs render the name from the config, never from the bus, so
            // a NewTitle only reaches them through here.
            if (this.appId && !freshCustom)
                updateAppConfig(this._settings, this.appId, {title});

            title = formatAppName(title);
        }

        applyTitle(this.actor, this._tooltip, this._settings, title);
    }

    async _updateMenuPath() {
        if (this._isDestroyed)
            return;
        const path = await refreshPropertyOnProxy(this._proxy, 'Menu');
        if (this._isDestroyed)
            return;
        if (this._menuClient && path !== this._menuPath)
            disposeAll(this, 'destroy', '_menuClient');
        this._menuPath = path;
    }

    async _contextMenu(anchor) {
        if (this._isMenuLoading)
            return;
        if (this._menu?.isOpen) {
            this._menu.toggle();
            return;
        }

        this._isMenuLoading = true;
        try {
            // The path can arrive after the item registered
            if (!this._menuPath)
                await this._updateMenuPath();
            if (this._isDestroyed || isDisposed(anchor))
                return;
            if (!this._menuPath) {
                this._fallbackToRemoteContextMenu(anchor, 'no menu path');
                return;
            }

            await this._ensureMenuClient();
            if (this._isDestroyed || isDisposed(anchor))
                return;

            await this._buildMenu(anchor);
            if (this._isDestroyed || isDisposed(anchor)) {
                this._disposeMenu();
                return;
            }

            this._presentMenu(anchor);
        } catch (e) {
            this._disposeMenu();
            // An app can advertise a menu path and still serve a menu we
            // cannot build, its own ContextMenu still works.
            this._fallbackToRemoteContextMenu(anchor, `menu failed to build, ${e.message}`);
        } finally {
            this._isMenuLoading = false;
        }
    }

    // An inline Background Apps menu is built here but owned by its row
    async _fillMenu(menu) {
        if (!this._menuPath)
            return false;
        await this._ensureMenuClient();
        await this._menuClient.buildMenu(menu);
        if (menu.isEmpty() && await this._menuClient?.waitForLayout()) {
            menu.removeAll();
            await this._menuClient?.buildMenu(menu);
        }
        return !menu.isEmpty();
    }

    // A menu still empty on its first build often gets its layout a moment later
    async _buildMenu(anchor) {
        this._createMenu(anchor);
        await this._menuClient.buildMenu(this._menu);
        if (!this._menu.isEmpty() || !await this._menuClient?.waitForLayout())
            return;
        if (this._isDestroyed || isDisposed(anchor))
            return;
        this._createMenu(anchor);
        await this._menuClient.buildMenu(this._menu);
    }

    // The app draws this menu itself, so a report of a centred or missing menu
    // needs the reason in the journal
    _fallbackToRemoteContextMenu(anchor, reason) {
        if (!this._proxy)
            return;
        warn(`${this.id} (${this.appId}) shows its own menu, ${reason}`);
        const [x, y] = global.get_pointer();
        disposeAll(this, 'cancel', '_remoteMenuPlacement');
        if (this._pid)
            this._remoteMenuPlacement = new RemoteMenuPlacement(this._pid, anchor);
        // Shell menus sit above every app window and would hide the app's menu
        panelMenuManagerFor(anchor).activeMenu?.close();
        this._proxy.ContextMenuRemote(x, y);
    }

    async _ensureMenuClient() {
        if (this._menuClient)
            return;
        this._menuClient = new DBusMenuClient(
            this.busName,
            this._menuPath,
            this._menuInterfaceXml,
            this._settings,
            menu => this._onCloseMenu(menu._trayAnchor ?? this.actor)
        );
        try {
            await this._menuClient.init();
        } catch (e) {
            // A broken proxy must not stay cached, every later open would
            // reuse it instead of retrying.
            disposeAll(this, 'destroy', '_menuClient');
            throw e;
        }
    }

    _createMenu(anchor) {
        this._disposeMenu();

        this._menu = createPanelMenu(menuAnchorFor(anchor));
        this._menu._trayAnchor = anchor;
        trackDisposal(this._menu.actor);

        // An auto-hiding panel only stays put while menuManager.activeMenu is
        // set, held by this menu or by the open popup underneath.
        menuManagerFor(anchor, this._settings).addMenu(this._menu);

        this._menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen)
                return;

            this._lastClose = {anchor, time: GLib.get_monotonic_time()};

            // A closed menu stays registered and still answers the manager's hover
            // switch, which reopens this stale copy instead of rebuilding it.
            // The drop waits a turn because the menu is mid-emission here.
            debounceTo(this, '_menuDropId', MENU_DROP_DELAY_MS, () => {
                if (this._menu === menu)
                    this._disposeMenu();
            });
        });
    }

    _disposeMenu() {
        destroyMenuSafely(this._menu);
        this._menu = null;
    }

    _presentMenu(anchor) {
        // An app serving an empty menu would get a blank popup
        // instead of its own ContextMenu.
        if (this._menu.isEmpty()) {
            this._disposeMenu();
            this._fallbackToRemoteContextMenu(anchor, 'empty menu layout');
            return;
        }

        this._menu.open(POPUP_ANIMATION_NONE);
    }

    destroy() {
        if (this._isDestroyed)
            return;
        this._isDestroyed = true;
        forgetItem(this.id);

        this._unreadUnsub?.();
        this._unreadUnsub = null;

        disposeAll(this, 'destroy', '_draggable', '_clickController', '_tooltip');
        disconnectSignal(this, this._settings, '_settingsConnectId');
        disposeAll(this, 'disconnect', '_colorSetWatch');
        clearIds(this, removeTimer, '_updateDeferId', '_titleDeferId', '_menuDropId', '_activateId');

        disconnectAll(this, this._proxy, '_proxySignals', 'disconnectSignal');
        disconnectAll(this, this._proxy, '_gObjectSignals');

        this._disposeMenu();
        disposeAll(this, 'destroy', '_menuClient');
        disposeAll(this, 'cancel', '_remoteMenuPlacement');

        if (!isDisposed(this.actor))
            this.actor.destroy();
        this.actor = null;

        this._onDestroy(this.id);
        this._proxy = null;
    }
}
