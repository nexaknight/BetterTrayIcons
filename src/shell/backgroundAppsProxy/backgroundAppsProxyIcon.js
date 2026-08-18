import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {warn} from '../../shared/logging.js';
import {configRenderDelta, displayAppName, reseedIfForgotten, unreadBadgeEnabled, updateAppConfig} from '../../shared/appConfig.js';
import {disconnectAll, disposeAll, ruleDispatcher} from '../../shared/lifecycle.js';
import {attachStatusIcon, createPanelMenu, destroyMenuSafely, isDisposed, menuAnchorFor, menuManagerFor, refreshTrayStyle, setBadgeContent, setIconContent, syncHoverStyle, trackDisposal, POPUP_ANIMATION_NONE} from '../utils/actor.js';
import {configuredIcon} from '../utils/icons.js';
import {addUnreadListener, unreadBadge, unreadTargets} from '../utils/launcherEntries.js';
import {applyTitle, createTrayActor, syncTooltip} from '../features/tooltip.js';
import {DRAG_SETTING_KEYS, setupIconDragSource, syncDragEnabled} from '../features/dragAndDrop.js';
import {TRAY_STYLE_KEYS} from '../../const.js';

export const BACKGROUND_PROXY_ID_PREFIX = 'bgproxy:';

const FLATPAK_KILL_ARGV = Object.freeze(['flatpak', 'kill']);

export class BackgroundAppsProxyIcon {
    constructor(appId, entry, settings, {onAfterClick, onDragStateChange, onQuit}) {
        this._settings = settings;
        this._app = entry.app;
        this._flatpakId = entry.flatpakId;
        this._onAfterClick = onAfterClick;
        this._onQuit = onQuit;
        this._isDestroyed = false;
        this._actorSignals = [];
        this._settingsSignals = [];
        this._menu = null;
        this._config = {};
        this._configSig = '';
        this._customIconValue = undefined;

        this.appId = appId;
        this.id = `${BACKGROUND_PROXY_ID_PREFIX}${appId}`;

        const {actor, tooltip} = createTrayActor(this.id, settings);
        this.actor = actor;
        this._tooltip = tooltip;
        this.actor._appId = appId;

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

        // The panel hides and orders every registered actor from its app-configs
        // entry, so hiding and reordering only reach this icon once the entry
        // exists. detected_icon and packaging are what let the prefs page
        // render the icon and the badge, it cannot reach Shell.AppSystem, and
        // the portal only ever lists flatpak instances.
        this._identitySeed = {
            title: this._app.get_name(),
            is_background_proxy: true,
            packaging: 'flatpak',
            detected_icon: _themedIconName(this._app),
        };
        updateAppConfig(settings, appId, this._identitySeed);

        this._connectSignals();
        refreshTrayStyle(this.actor, this._iconActor, this._settings);
        this._applyConfig();
    }

    _connectSignals() {
        this._actorSignals.push(
            this.actor.connect('button-release-event', (_actor, event) => {
                if (event.get_button() === Clutter.BUTTON_SECONDARY)
                    this._openMenu();
                else
                    this._activate();
                return Clutter.EVENT_PROPAGATE;
            }),
            this.actor.connect('notify::hover', () => {
                syncHoverStyle(this.actor);
                syncTooltip(this.actor, this._tooltip, this._settings);
            }));

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
    }

    _activate() {
        this._app.activate();
        this._onAfterClick();
    }

    _openMenu() {
        if (this._menu?.isOpen) {
            this._menu.close(POPUP_ANIMATION_NONE);
            return;
        }
        // Rebuilt per open, because the icon moves between the panel and the
        // overflow popup and the anchor differs between the two.
        this._destroyMenu();
        this._menu = this._createMenu();
        this._menu.open(POPUP_ANIMATION_NONE);
    }

    // Quitting kills a running backup or sync with no confirmation and no undo,
    // so it sits behind a labelled item rather than a bare middle click that
    // says nothing about what it does. GNOME's own background apps list puts it
    // behind a labelled button for the same reason.
    _createMenu() {
        const menu = createPanelMenu(menuAnchorFor(this.actor));
        trackDisposal(menu.actor);
        menuManagerFor(this.actor, this._settings)?.addMenu(menu);

        const show = new PopupMenu.PopupMenuItem(_('Show'));
        show.connect('activate', () => this._activate());
        menu.addMenuItem(show);

        const quit = new PopupMenu.PopupMenuItem(_('Quit'));
        quit.connect('activate', () => this._quit());
        menu.addMenuItem(quit);
        return menu;
    }

    _destroyMenu() {
        destroyMenuSafely(this._menu);
        this._menu = null;
    }

    // Measured on KeePassXC: it owns only org.keepassxc.KeePassXC.MainWindow and
    // no quit action, so the item would sit there doing nothing. The shell's own
    // background apps list falls back the same way. One fork per explicit click,
    // never on the refresh path.
    async _quit() {
        try {
            await this._app.activate_action('quit', null, 0, -1, null);
        } catch {
            try {
                Util.trySpawn([...FLATPAK_KILL_ARGV, this._flatpakId]);
            } catch (e) {
                warn(`BackgroundAppsProxyIcon: quit failed for ${this.appId}: ${e.message}`);
                return;
            }
        }
        this._onQuit();
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

    // Only the LauncherEntry count, there is no state or icon signal a dot
    // could follow here.
    _syncBadge() {
        const badge = unreadBadgeEnabled(this._config)
            ? unreadBadge(this._unreadTargets)
            : null;
        setBadgeContent(this.actor, this._settings, badge,
            badge ? this._config.badge_style ?? null : null);
    }

    _applyCustomIcon() {
        const value = this._config.custom_icon ?? null;
        if (value === this._customIconValue)
            return;
        this._customIconValue = value;

        const {gicon, iconName} = value
            ? configuredIcon(value, this._settings)
            : {gicon: this._app.get_icon(), iconName: null};

        setIconContent(this._iconActor, gicon, iconName);
    }

    // One source with the prefs row, which renders the same config fields.
    // The portal message is runtime state, not a name, and showing it here
    // made the tooltip disagree with the row.
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
