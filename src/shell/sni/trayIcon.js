import GLib from 'gi://GLib';

import {warn, warnOnce} from '../../shared/logging.js';
import {configRenderDelta, getAppConfigMap, getAppConfigValue, setAppConfigValue, updateAppConfig, reseedIfForgotten, formatAppName, isVolatileIconName, unreadBadgeEnabled} from '../../shared/appConfig.js';
import {clearIds, debounceTo, disconnectSignal, disconnectAll, disposeAll, removeTimer, ruleDispatcher} from '../../shared/lifecycle.js';
import {getItemAddress, refreshPropertyOnProxy, refreshStringOnProxy} from '../utils/dbus.js';
import {identifyApp, resolveTrayIcon} from '../utils/icons.js';
import {pickDisplayTitle} from '../utils/appId.js';
import {forgetItem} from '../utils/itemSplit.js';
import {attachStatusIcon, isDisposed, trackDisposal, createPanelMenu, menuAnchorFor, menuManagerFor, destroyMenuSafely, refreshTrayStyle, setBadgeContent, setIconContent, syncHoverStyle, POPUP_ANIMATION_NONE} from '../utils/actor.js';
import {addUnreadListener, unreadTargets} from '../utils/launcherEntries.js';
import {DBusMenuClient} from './dbusMenuClient.js';
import {ClickController} from '../features/clickController.js';
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

// Keys that need a fresh resolve rather than a restyle. The color ones decide
// the tint that goes into a symbolic icon's bytes, which no restyle can change.
const ICON_RESOLVE_KEYS = Object.freeze([
    'icon-size',
    'enable-symbolic-icons',
    'icon-color',
    'enable-custom-icon-style',
    'icon-use-accent-color',
]);

export class TrayIcon {
    constructor(extensionDir, busName, objectPath, settings, proxy, onReady, onDestroy, onCloseMenu, onDragStateChange = null) {
        this._extensionDir = extensionDir;
        this.busName = busName;
        this._objectPath = objectPath;
        this._settings = settings;
        this._proxy = proxy;
        this._onReady = onReady;
        this._onDestroy = onDestroy;
        this._onCloseMenu = onCloseMenu;
        this._onDragStateChange = onDragStateChange;

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
        this._menuClient = null;
        this._tooltip = null;
        this._clickController = null;
        this._lastCloseTime = 0;

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
            if (this._isDestroyed)
                return;

            // A sibling can prove the split while this call is still settling,
            // and its rekey already holds the id this item ends up on.
            this.appId ??= identity.appId;
            this._identitySeed = identity.seed;
            this._pid = identity.pid;
            this._processName = identity.processName;
            this.actor._appId = this.appId;

            // A proxied app that grew a real tray icon keeps its proxy flag
            // forever, updateAppConfig never removes fields. Stale, it keeps
            // the Background badge and the proxy dialog variant alive.
            if (getAppConfigValue(this._settings, this.appId, 'is_background_proxy') === true)
                setAppConfigValue(this._settings, this.appId, 'is_background_proxy', null);

            if (this._draggable)
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

            if (!this._isDestroyed)
                this._onReady(this.id, this.actor);
        } catch (e) {
            warn(`TrayIcon: Ident/Update failed: ${e.message}`);
        }
    }

    // Only the id moves: the carry-over write that follows arrives as an
    // app-configs change, and the rule for that key re-renders.
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
    }

    _configChanged() {
        if (!this.appId)
            return true;
        const {sig, changed} = configRenderDelta(this._settings, this.appId, this._configSig);
        this._configSig = sig;
        return changed;
    }

    // For signals whose source can outlive `this`.
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
        if (this._isDestroyed || this._updateDeferId)
            return;

        const sinceLast = (GLib.get_monotonic_time() - this._lastUpdateRun) / 1000;
        const delay = Math.max(ICON_UPDATE_DELAY_MS, ICON_UPDATE_MIN_INTERVAL_MS - sinceLast);

        this._updateDeferId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateDeferId = 0;
            this._lastUpdateRun = GLib.get_monotonic_time();
            if (!this._isDestroyed)
                this._swallow(this._updateIcon(), 'updateIcon');
            return GLib.SOURCE_REMOVE;
        });
    }

    // Chatty apps rewrite their title per progress tick, one refresh per
    // burst is enough for the tooltip and the prefs list.
    _queueTitleUpdate() {
        if (this._isDestroyed || this._titleDeferId)
            return;

        this._titleDeferId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TITLE_UPDATE_DEBOUNCE_MS, () => {
            this._titleDeferId = 0;
            if (!this._isDestroyed)
                this._swallow(this._updateTitle(), 'updateTitle');
            return GLib.SOURCE_REMOVE;
        });
    }

    _createUI() {
        const {actor, tooltip} = createTrayActor(`TrayIcon ${this.id}`, this._settings);
        this.actor = actor;
        this._tooltip = tooltip;

        this._iconActor = attachStatusIcon(this.actor);

        this.actor.connect('notify::hover', this._guarded(() => {
            syncHoverStyle(this.actor);

            if (this.actor.hover && this._tooltip && !this._tooltip._label.text)
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

        this._clickController = new ClickController(
            this.actor,
            this._settings,
            'tray',
            action => this._executeAction(action),
            {propagateEvent: true}
        );

        this._draggable?.setClickController(this._clickController);

        refreshTrayStyle(this.actor, this._iconActor, this._settings);
    }

    _executeAction(action) {
        // 'drag-drop' is a config marker, not a click action. The drag starts
        // on mouse motion, so there's nothing to fire on long-press release.
        if (this._isDestroyed || !action || action === 'nothing' || action === 'drag-drop')
            return;

        switch (action) {
        case 'activate':
            this._fireAndClose('ActivateRemote');
            break;
        case 'secondary':
            this._fireAndClose('SecondaryActivateRemote');
            break;
        case 'menu':
            // The click that closes a popup also fires here, which would
            // toggle it right back on.
            if (GLib.get_monotonic_time() - this._lastCloseTime < MENU_REOPEN_GUARD_MS * 1000)
                return;
            this._contextMenu();
            break;
        }
    }

    // Items without Activate answer UnknownMethod, the click did nothing
    // and closing would gain nothing, so the close waits for the reply.
    _fireAndClose(method) {
        this._proxy[method](0, 0, (_result, err) => {
            if (this._isDestroyed)
                return;
            if (err && this._settings.get_boolean('keep-popup-on-failed-click')) {
                warnOnce(`${method}:${this.appId}`,
                    `${this.id} does not answer ${method}, leaving the popup open: ${err.message}`);
                return;
            }
            this._onCloseMenu();
        });
    }

    // Runs for an unidentified item too: it has no stored config, but the
    // Passive rule still decides whether it shows.
    _applyStoredConfig() {
        const hidden = getAppConfigValue(this._settings, this.appId, 'is_hidden', false);
        this.actor.visible = !hidden && !this.actor._isPassive;
    }

    async _updateIcon() {
        if (this._isDestroyed)
            return;

        // _queueUpdate only guards against a second timer, not against a second
        // run: the proxy roundtrips inside resolveTrayIcon take as long as the
        // peer needs, so a slow run can still be in flight when the next one
        // starts. Whoever returns last used to win, which parks the icon on a
        // stale status or pixmap until something else triggers an update.
        const generation = ++this._updateGen;

        const {gicon, iconName, detected, status, pixmapHash, unchanged, badge} = await resolveTrayIcon(
            this._proxy,
            this._settings,
            this.appId,
            this._pixmapHash,
            this._pid,
            this._iconTint()
        );

        if (this._isDestroyed || generation !== this._updateGen)
            return;

        this._pixmapHash = pixmapHash ?? null;

        const entry = this.appId ? getAppConfigMap(this._settings)[this.appId] : null;
        this._syncUnreadListener(entry);

        // The spec calls Passive an idle status visualizations are likely to
        // hide, and apps like KDE Connect park there instead of unregistering.
        const wasPassive = this.actor._isPassive;
        this.actor._isPassive = status === 'Passive';
        if (wasPassive !== this.actor._isPassive)
            this._applyStoredConfig();

        if (!unchanged)
            setIconContent(this._iconActor, gicon, iconName || 'image-missing');
        // Also on unchanged frames: a count change reuses the cached pixmap.
        setBadgeContent(this.actor, this._settings, badge,
            badge ? entry?.badge_style ?? null : null);

        // Alert names are not the calm baseline and volatile names would
        // rewrite the blob per frame. A missing baseline is seeded even during
        // an alert, apps booting in attention state would never get one.
        if (this.appId && detected.iconName &&
            (!detected.hasAlert || detected.baselineMissing) &&
            !isVolatileIconName(detected.iconName)) {
            const updateData = {detected_icon: detected.iconName};
            if (detected.iconThemePath)
                updateData.icon_theme_path = detected.iconThemePath;
            updateAppConfig(this._settings, this.appId, updateData);
        }
    }

    // St already resolves the accent keyword and the panel default, which
    // settings alone cannot, so a tinted icon matches what a themed one would
    // look like. Off the stage it answers with its own default foreground
    // instead of failing, which would tint the first frame black.
    _iconTint() {
        if (!this._iconActor.get_stage())
            return null;
        return this._iconActor.get_theme_node().get_foreground_color().to_string();
    }

    // Registered only while the badge is on, an idle listener would turn
    // every LauncherEntry emission into a full resolve. An item still
    // waiting for its pid registers nothing and gets another try on the
    // next resolve.
    _syncUnreadListener(entry) {
        if (!unreadBadgeEnabled(entry)) {
            this._unreadUnsub?.();
            this._unreadUnsub = null;
            return;
        }
        this._unreadUnsub ??= addUnreadListener(unreadTargets({
            pid: this._pid,
            appId: this.appId,
            packagingKind: entry?.packaging ?? null,
        }), this._guarded(() => this._queueUpdate()));
    }

    async _updateTitle() {
        if (this._isDestroyed)
            return;

        // A NewTitle burst overlaps roundtrips, and the slower answer would
        // land its older title last.
        const gen = ++this._titleGen;
        let title = getAppConfigValue(this._settings, this.appId, 'custom_title');
        if (!title) {
            const raw = await refreshStringOnProxy(this._proxy, 'Title');
            if (this._isDestroyed || gen !== this._titleGen)
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
        // The cached client is bound to the old path, drop it so the next
        // open rebuilds against the new one.
        if (this._menuClient && path !== this._menuPath)
            disposeAll(this, 'destroy', '_menuClient');
        this._menuPath = path;
    }

    async _contextMenu() {
        if (this._isMenuLoading || this._isDestroyed)
            return;
        if (this._menu?.isOpen) {
            this._menu.toggle();
            return;
        }

        if (!this._menuPath) {
            this._fallbackToRemoteContextMenu();
            return;
        }

        this._isMenuLoading = true;
        try {
            await this._ensureMenuClient();
            if (this._isDestroyed)
                return;

            this._createMenu();
            await this._menuClient.buildMenu(this._menu);
            if (this._isDestroyed) {
                this._disposeMenu();
                return;
            }

            this._presentMenu();
        } catch (e) {
            warn(`Failed to open context menu for ${this.id}: ${e.message}`);
            this._disposeMenu();
            // An app can advertise a menu path and still serve a menu we cannot
            // build. Without this the right-click did nothing at all, forever,
            // while the app's own ContextMenu was there the whole time.
            this._fallbackToRemoteContextMenu();
        } finally {
            this._isMenuLoading = false;
        }
    }

    _fallbackToRemoteContextMenu() {
        if (!this._proxy)
            return;
        const [x, y] = global.get_pointer();
        this._proxy.ContextMenuRemote(x, y);
    }

    async _ensureMenuClient() {
        if (this._menuClient)
            return;
        this._menuClient = new DBusMenuClient(
            this.busName,
            this._menuPath,
            this._extensionDir,
            this._settings,
            this._onCloseMenu
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

    _createMenu() {
        this._disposeMenu();

        this._menu = createPanelMenu(menuAnchorFor(this.actor));
        trackDisposal(this._menu.actor);

        // Hide Top Bar only stays put while Main.panel.menuManager.activeMenu
        // is set, held either by this menu or by the open popup underneath.
        menuManagerFor(this.actor, this._settings)?.addMenu(this._menu);

        this._menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen)
                return;

            this._lastCloseTime = GLib.get_monotonic_time();

            // A closed menu stays registered and still answers the manager's
            // hover switch, which reopens this stale copy instead of rebuilding
            // it. The drop waits a turn because the menu is mid-emission here.
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

    _presentMenu() {
        // isEmpty, not length: PopupMenu has no length, so this guard used to
        // compare undefined to 0 and never fired. An app serving an empty menu
        // got a blank popup instead of its own ContextMenu.
        if (this._menu.isEmpty()) {
            this._disposeMenu();
            this._fallbackToRemoteContextMenu();
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
        clearIds(this, removeTimer, '_updateDeferId', '_titleDeferId', '_menuDropId');

        disconnectAll(this, this._proxy, '_proxySignals', 'disconnectSignal');
        disconnectAll(this, this._proxy, '_gObjectSignals');

        this._disposeMenu();
        disposeAll(this, 'destroy', '_menuClient');

        if (!isDisposed(this.actor))
            this.actor.destroy();
        this.actor = null;

        this._onDestroy(this.id);
        this._proxy = null;
    }
}
