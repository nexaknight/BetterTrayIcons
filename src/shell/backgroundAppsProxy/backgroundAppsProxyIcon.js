import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {warn} from '../../shared/logging.js';
import {configRenderDelta, displayAppName, reseedIfForgotten, unreadBadgeEnabled, updateAppConfig} from '../../shared/appConfig.js';
import {disconnectAll, disposeAll, ruleDispatcher} from '../../shared/lifecycle.js';
import {attachStatusIcon, setBadgeContent, setIconContent} from '../icons/iconContent.js';
import {connectColorSetChanges, refreshTrayStyle, syncHoverStyle} from '../trayStyle.js';
import {connectSurfaceChanges} from '../actorPlacement.js';
import {isDisposed, trackDisposal} from '../disposal.js';
import {createPanelMenu, destroyMenuSafely, menuAnchorFor, menuManagerFor, POPUP_ANIMATION_NONE} from '../popupMenus.js';
import {configuredIcon, themedIconContent} from '../icons/iconResolver.js';
import {addUnreadListener, inFrontActionFor, unreadBadge, unreadTargets} from '../features/launcherEntries.js';
import {applyTitle, createTrayActor, syncTooltip} from '../features/tooltip.js';
import {DRAG_SETTING_KEYS, setupIconDragSource, syncDragEnabled} from '../features/dragAndDrop.js';
import {bindTrayClicks} from '../features/clickController.js';
import {TRAY_STYLE_KEYS} from '../../const.js';
import {callDBusDaemon} from '../dbusCalls.js';

export const BACKGROUND_PROXY_ID_PREFIX = 'bgproxy:';

const FLATPAK_KILL_ARGV = Object.freeze(['flatpak', 'kill']);

const QUIT_ACTION_RE = /^quit$/i;

const NEW_WINDOW_ACTION = 'new-window';

const QUIT_GACTION = 'quit';

const APPLICATION_IFACE = 'org.freedesktop.Application';

export class BackgroundAppsProxyIcon {
    constructor(appId, entry, settings, {onAfterClick, onDragStateChange, onQuit}) {
        this._settings = settings;
        this._app = entry.app;
        this._flatpakId = entry.flatpakId;
        this._message = entry.message;
        this._onAfterClick = onAfterClick;
        this._onQuit = onQuit;
        this._isDestroyed = false;
        this._actorSignals = [];
        this._settingsSignals = [];
        this._menu = null;
        this._config = {};
        this._configSig = '';
        this._customIconValue = undefined;
        this._statusItem = null;
        this._detectedIcon = _themedIconName(this._app);

        this.appId = appId;
        this.id = `${BACKGROUND_PROXY_ID_PREFIX}${appId}`;

        const {actor, tooltip} = createTrayActor(settings);
        this.actor = actor;
        this._tooltip = tooltip;
        this.actor._appId = appId;
        this.actor._trayAction = (action, _event, anchor) => this._executeAction(action, anchor);
        this.actor._trayFillMenu = menu => {
            this._fillMenu(menu, this.actor);
            return true;
        };
        this.actor._trayRestyle = () => refreshTrayStyle(this.actor, this._iconActor, this._settings);

        this._iconActor = attachStatusIcon(this.actor);

        // The portal only lists flatpaks, so the desktop id is known up front
        // and needs no window to resolve, unlike the SNI path.
        this._unreadTargets = unreadTargets({appId, packagingKind: 'flatpak'});
        this._unreadUnsub = addUnreadListener(this._unreadTargets,
            () => this._syncBadge());

        this._draggable = setupIconDragSource({
            actor: this.actor,
            appId,
            settings,
            tooltip,
            onForwardedDragStateChange: onDragStateChange,
        });

        // The panel hides and orders actors from their app-configs entry, so
        // those only reach this icon once the entry exists. The prefs cannot
        // reach Shell.AppSystem, detected_icon and packaging are what it draws.
        this._identitySeed = {
            title: this._app.get_name(),
            is_background_proxy: true,
            packaging: 'flatpak',
            detected_icon: this._detectedIcon,
        };
        updateAppConfig(settings, appId, this._identitySeed);

        this._connectSignals();
        refreshTrayStyle(this.actor, this._iconActor, this._settings);
        this._applyConfig();
    }

    setMessage(message) {
        this._message = message;
        this._statusItem?.label.set_text(statusText(this._message));
    }

    _connectSignals() {
        this._actorSignals.push(
            this.actor.connect('notify::hover', () => {
                syncHoverStyle(this.actor);
                syncTooltip(this.actor, this._tooltip, this._settings);
            }));

        // A proxy is a tray icon to the user, so it answers the same bindings.
        this._clickController = bindTrayClicks(this.actor, this._settings, this._draggable,
            action => this._executeAction(action));

        const rules = [
            {match: key => TRAY_STYLE_KEYS.includes(key), run: () => refreshTrayStyle(this.actor, this._iconActor, this._settings)},
            {match: key => key === 'enable-tooltips', run: () => this._updateTitle()},
            {
                match: key => key === 'app-configs', run: () => {
                    reseedIfForgotten(this._settings, this.appId, this._identitySeed);
                    this._applyConfig();
                },
            },
            {
                match: key => key === 'enable-symbolic-icons', run: () => {
                    this._customIconValue = undefined;
                    this._applyCustomIcon();
                },
            },
            {
                match: key => DRAG_SETTING_KEYS.includes(key),
                run: () => syncDragEnabled(this._draggable, this._settings),
            },
            // The badge derives its size from the icon size.
            {match: key => key === 'icon-size', run: () => this._syncBadge()},
        ];
        this._settingsSignals.push(this._settings.connect('changed', ruleDispatcher(rules)));
        const applyColorSet = () => {
            if (!this._isDestroyed)
                refreshTrayStyle(this.actor, this._iconActor, this._settings);
        };
        this._colorSetWatch = connectColorSetChanges(this._settings, applyColorSet);
        connectSurfaceChanges(this.actor, applyColorSet);
    }

    // An app has no SecondaryActivate to answer, so 'secondary' resolves to
    // nothing here. 'drag-drop' is a config marker, the drag starts on motion.
    _executeAction(action, anchor = this.actor) {
        switch (action) {
        case 'activate':
            this._activateFromClick(anchor);
            break;
        case 'menu':
            this._openMenu(anchor);
            break;
        }
    }

    // The menu's Show entry always shows, only a click on the icon runs the
    // in-front action.
    _activateFromClick(anchor) {
        const isInFront = this._app === Shell.WindowTracker.get_default().focus_app;
        const inFrontAction = isInFront && inFrontActionFor(this._settings, this.appId);
        if (!inFrontAction) {
            this._activate(anchor);
            return;
        }
        this._onAfterClick(anchor);
        inFrontAction(this._app);
    }

    _activate(anchor) {
        this._onAfterClick(anchor);
        this._app.activate();
    }

    _openMenu(anchor) {
        if (this._menu?.isOpen) {
            this._menu.close(POPUP_ANIMATION_NONE);
            return;
        }
        // Rebuilt per open, because the icon moves between the panel and the
        // overflow popup and the anchor differs between the two.
        this._destroyMenu();
        this._menu = this._createMenu(anchor);
        this._menu.open(POPUP_ANIMATION_NONE);
    }

    _createMenu(anchor) {
        const menu = createPanelMenu(menuAnchorFor(anchor));
        trackDisposal(menu.actor);
        menuManagerFor(anchor, this._settings).addMenu(menu);
        this._statusItem = this._fillMenu(menu, anchor);
        return menu;
    }

    _fillMenu(menu, anchor) {
        return fillBackgroundAppMenu(menu, {
            app: this._app,
            message: this._message,
            onShow: () => this._activate(anchor),
            onQuit: timestamp => this._quit(timestamp),
        });
    }

    _destroyMenu() {
        destroyMenuSafely(this._menu);
        this._menu = null;
        this._statusItem = null;
    }

    async _quit(timestamp) {
        // The Background Apps menu follows the portal list on its own
        if (await requestQuit(this._app, this._flatpakId, timestamp))
            this._onQuit?.();
    }

    _applyConfig() {
        const {entry, sig, changed} = configRenderDelta(this._settings, this.appId, this._configSig);
        if (!changed)
            return;

        this._configSig = sig;
        this._config = entry;
        this._applyCustomIcon();
        this._updateTitle();
        this._syncBadge();
    }

    // Only the LauncherEntry count, no state or icon signal here feeds a dot.
    _syncBadge() {
        const badge = unreadBadgeEnabled(this._config)
            ? unreadBadge(this._unreadTargets)
            : null;
        setBadgeContent(this.actor, this._settings, badge,
            badge ? this._config.badge_style : null);
    }

    _applyCustomIcon() {
        const value = this._config.custom_icon ?? null;
        if (value === this._customIconValue)
            return;
        this._customIconValue = value;

        setIconContent(this._iconActor, value
            ? configuredIcon(value, this._settings)
            : this._appIcon());
    }

    _appIcon() {
        return this._detectedIcon
            ? themedIconContent(this._detectedIcon, this._settings)
            : {gicon: this._app.get_icon(), iconName: null};
    }

    // The portal message is runtime state, not a name, so the tooltip stays on
    // the config name the prefs row renders.
    _updateTitle() {
        applyTitle(this.actor, this._tooltip, this._settings,
            displayAppName(this._config, this._app.get_name()));
    }

    destroy() {
        if (this._isDestroyed)
            return;
        this._isDestroyed = true;

        this._unreadUnsub();
        this._unreadUnsub = null;

        disposeAll(this, 'destroy', '_draggable', '_tooltip');
        disconnectAll(this, this._settings, '_settingsSignals');
        disconnectAll(this, this.actor, '_actorSignals');
        disposeAll(this, 'disconnect', '_colorSetWatch');

        this._destroyMenu();

        if (!isDisposed(this.actor))
            this.actor.destroy();
        this.actor = null;
    }
}

function _themedIconName(app) {
    const icon = app.get_icon();
    return icon instanceof Gio.ThemedIcon ? icon.get_names()[0] ?? null : null;
}

function fillBackgroundAppMenu(menu, {app, message, onShow, onQuit}) {
    const statusItem = new PopupMenu.PopupMenuItem(statusText(message),
        {reactive: false, can_focus: false});
    menu.addMenuItem(statusItem);
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const actions = desktopActions(app);
    for (const [action, label] of actions) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', (_item, event) =>
            app.launch_action(action, event.get_time(), -1));
        menu.addMenuItem(item);
    }
    if (actions.length > 0)
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const show = new PopupMenu.PopupMenuItem(_('Show'));
    show.connect('activate', () => onShow());
    menu.addMenuItem(show);

    const quit = new PopupMenu.PopupMenuItem(_('Quit'));
    quit.connect('activate', (_item, event) => onQuit(event.get_time()));
    menu.addMenuItem(quit);
    return statusItem;
}

function statusText(message) {
    return message ?? _('Running in the background');
}

function desktopActions(app) {
    const info = app.app_info;
    const quit = quitAction(app);
    return info.list_actions()
        .filter(action => action !== NEW_WINDOW_ACTION && action !== quit)
        .map(action => [action, info.get_action_name(action)]);
}

function quitAction(app) {
    return app.app_info.list_actions().find(name => QUIT_ACTION_RE.test(name));
}

// Gentlest first, and none may start anything. activate_action and a D-Bus
// activatable launch_action auto-start the main name (src/shell-app.c), which
// relaunches a windowless app, so the D-Bus ways only reach owned names.
async function requestQuit(app, flatpakId, timestamp) {
    const action = quitAction(app);
    const isDBusActivatable = app.app_info.get_boolean('DBusActivatable');
    if (action && !isDBusActivatable) {
        app.launch_action(action, timestamp, -1);
        return true;
    }

    const owned = await ownedAppNames(flatpakId);
    // One at a time, the first name that takes a quit ends the chain
    const actions = action ? [action, QUIT_GACTION] : [QUIT_GACTION];
    const attempts = owned.flatMap(name => actions.map(actionName => [name, actionName]));
    const isQuitTaken = await attempts.reduce(
        (taken, [name, actionName]) => taken.then(done => done || activateOwnedAction(name, actionName)),
        Promise.resolve(false));
    if (isQuitTaken)
        return true;

    try {
        Util.trySpawn([...FLATPAK_KILL_ARGV, flatpakId]);
        return true;
    } catch (e) {
        warn(`Background app quit failed for ${flatpakId}: ${e.message}`);
        return false;
    }
}

// The main name first, then the app's own sub-names
async function ownedAppNames(appId) {
    try {
        const reply = await callDBusDaemon(Gio.DBus.session, 'ListNames', null, new GLib.VariantType('(as)'));
        const [names] = reply.deep_unpack();
        return names
            .filter(name => name === appId || name.startsWith(`${appId}.`))
            .sort((a, b) => a.length - b.length);
    } catch {
        return [];
    }
}

async function activateOwnedAction(busName, actionName) {
    try {
        await Gio.DBus.session.call(busName, applicationObjectPath(busName),
            APPLICATION_IFACE, 'ActivateAction',
            new GLib.Variant('(sava{sv})', [actionName, [], {}]),
            null, Gio.DBusCallFlags.NO_AUTO_START, -1, null);
        return true;
    } catch {
        return false;
    }
}

// GApplication's own rule for the path it exports under its id
function applicationObjectPath(appId) {
    return `/${appId.replaceAll('.', '/').replaceAll('-', '_')}`;
}
