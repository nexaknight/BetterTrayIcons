import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {warn} from '../shared/logging.js';
import {getAppConfigMap, getAppConfigValue, updateAppConfig, formatAppName} from '../shared/appConfig.js';
import {clearIds, disconnectSignal, disconnectAll, disposeAll, removeTimer} from '../shared/lifecycle.js';
import {getUniqueId, refreshPropertyOnProxy} from './utils/dbus.js';
import {identifyApp, resolveTrayIcon} from './utils/icons.js';
import {isDisposed, computeTrayIconStyle} from './utils/actor.js';
import {DBusMenuClient} from './dbusMenuClient.js';
import {ClickController} from './features/clickController.js';
import {
    isDragEnabledFromSettings,
    setupIconDragSource,
} from './features/dragAndDrop.js';
import {Tooltip} from './features/tooltip.js';
import {
    DRAG_SETTING_KEYS,
    ICON_UPDATE_DELAY_MS,
    POPUP_ANIMATION_NONE,
    MENU_REOPEN_GUARD_MS,
    DRAGGING_SOURCE_OPACITY,
    TRAY_STYLE_KEYS,
    TRAY_CONFIG_RENDER_FIELDS,
} from '../const.js';

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

        this.id = getUniqueId(busName, objectPath);
        this.appId = null;
        this.actor = null;
        this._isDestroyed = false;

        this._updateDeferId = 0;
        this._settingsConnectId = 0;
        this._configSig = null;
        this._pixmapHash = null;
        this._baseStyle = '';
        this._hoverStyle = '';

        this._proxySignals = [];
        this._gObjectSignals = [];

        this._menu = null;
        this._menuClient = null;
        this._menuManager = null;
        this._tooltip = null;
        this._clickController = null;
        this._lastCloseTime = 0;

        this._setup();
    }

    async _setup() {
        if (this._isDestroyed)
            return;

        this._connectProxySignals();
        this._connectPropertyChanges();
        this._connectSettingsChanges();
        this._createUI();

        try {
            const identity = await identifyApp(this._proxy, this.busName, this._settings);
            if (this._isDestroyed)
                return;

            this.appId = identity.appId;
            if (this.actor)
                this.actor._appId = this.appId;

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

            if (this._onReady && !this._isDestroyed)
                this._onReady(this.id, this.actor);
        } catch (e) {
            warn(`TrayIcon: Ident/Update failed: ${e.message}`);
        }
    }

    _connectProxySignals() {
        const handlers = {
            NewIcon: () => this._queueUpdate(),
            NewAttentionIcon: () => this._queueUpdate(),
            NewOverlayIcon: () => this._queueUpdate(),
            NewStatus: () => this._queueUpdate(),
            NewTitle: () => this._swallow(this._updateTitle(), 'updateTitle'),
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
                    if (!this._configChanged())
                        return;
                    this._applyStoredConfig();
                    this._queueUpdate();
                    this._swallow(this._updateTitle(), 'updateTitle');
                },
            },
            {match: key => TRAY_STYLE_KEYS.includes(key), run: () => this._updateStyle()},
            // Only these change which icon gets resolved, styling alone
            // doesn't warrant a refetch.
            {match: key => key === 'icon-size' || key === 'enable-symbolic-icons', run: () => this._queueUpdate()},
            {match: key => key === 'enable-tooltips', run: () => this._swallow(this._updateTitle(), 'updateTitle')},
            {match: key => DRAG_SETTING_KEYS.includes(key), run: () => this._applyDragEnabled()},
        ];

        this._settingsConnectId = this._settings.connect(
            'changed',
            this._guarded((_settings, key) => {
                for (const rule of rules) {
                    if (rule.match(key))
                        rule.run();
                }
            })
        );
    }

    // Every app-configs write lands on every icon, any app, any field.
    // Comparing the fields this icon renders from keeps one write from
    // fanning out into a refetch per icon.
    _configChanged() {
        if (!this.appId)
            return true;
        const entry = getAppConfigMap(this._settings)[this.appId] ?? {};
        const sig = JSON.stringify(TRAY_CONFIG_RENDER_FIELDS.map(f => entry[f] ?? null));
        if (sig === this._configSig)
            return false;
        this._configSig = sig;
        return true;
    }

    // Wraps a callback so it no-ops after destroy().
    // For signals whose source can outlive `this`.
    _guarded(fn) {
        return (...args) => {
            if (!this._isDestroyed)
                fn.apply(this, args);
        };
    }

    // Logs rejection on updates fired without await.
    _swallow(promise, label) {
        promise?.catch?.(e => warn(`${label} failed for ${this.id}: ${e.message}`));
    }

    _queueUpdate() {
        if (this._isDestroyed)
            return;
        clearIds(this, removeTimer, '_updateDeferId');

        this._updateDeferId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ICON_UPDATE_DELAY_MS, () => {
            this._updateDeferId = 0;
            if (!this._isDestroyed)
                this._swallow(this._updateIcon(), 'updateIcon');
            return GLib.SOURCE_REMOVE;
        });
    }

    _createUI() {
        if (this._isDestroyed)
            return;

        this.actor = new St.Bin({
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_expand: true,
            x_expand: false,
            y_align: Clutter.ActorAlign.FILL,
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._iconActor = new St.Icon({
            style_class: 'system-status-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.set_child(this._iconActor);

        try {
            this._tooltip = new Tooltip(this.actor, this._settings);
        } catch (e) {
            warn(`TrayIcon: Failed to create tooltip for ${this.id}: ${e.message}`);
        }

        this.actor.connect('notify::hover', () => {
            if (this._isDestroyed)
                return;
            this._updateHoverState();

            const isHovering = this.actor.hover;
            const tooltipsEnabled = this._settings.get_boolean('enable-tooltips');

            if (isHovering) {
                if (this._tooltip && !this._tooltip._label.text)
                    this._swallow(this._updateTitle(), 'updateTitle');

                if (this._tooltip && tooltipsEnabled)
                    this._tooltip.trigger();
            } else if (this._tooltip) {
                this._tooltip.hide();
            }
        });

        this._draggable = setupIconDragSource({
            actor: this.actor,
            appId: this.appId || this.id,
            settings: this._settings,
            label: this.id,
            onLocalDragStateChange: isDragging => {
                if (this._isDestroyed || !this.actor)
                    return;
                this.actor.opacity = isDragging ? DRAGGING_SOURCE_OPACITY : 255;
                // Hide on both begin and end, because notify::hover doesn't
                // re-fire after a drag ends if the pointer never left the icon.
                // A tooltip shown before would stick.
                if (this._tooltip)
                    this._tooltip.hide();
            },
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

        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
        this._updateStyle();
    }

    _applyDragEnabled() {
        this._draggable?.setEnabled(isDragEnabledFromSettings(this._settings));
    }

    _executeAction(action) {
        if (this._isDestroyed || !action || action === 'nothing')
            return;

        // 'drag-drop' is a config marker, not a click action. The actual
        // drag is started by mouse motion, so there's nothing to fire on
        // long-press release.
        if (action === 'drag-drop')
            return;

        switch (action) {
        case 'activate':
            this._proxy?.ActivateRemote(0, 0);
            this._onCloseMenu?.();
            break;
        case 'secondary':
            this._proxy?.SecondaryActivateRemote(0, 0);
            this._onCloseMenu?.();
            break;
        case 'menu':
            // Guard against immediate reopen after a close.
            // The click that closes a popup also fires here, which would
            // toggle it right back on.
            if (GLib.get_monotonic_time() - this._lastCloseTime < MENU_REOPEN_GUARD_MS * 1000)
                return;
            this._contextMenu();
            break;
        }
    }

    _updateStyle() {
        if (this._isDestroyed || !this.actor)
            return;

        this._iconActor.set_icon_size(this._settings.get_int('icon-size'));

        const {enableCustom, baseStyle, hoverStyle} = computeTrayIconStyle(this._settings);
        if (enableCustom) {
            this.actor.remove_style_class_name('panel-button');
            this._iconActor.remove_style_class_name('system-status-icon');
        } else {
            this.actor.add_style_class_name('panel-button');
            this._iconActor.add_style_class_name('system-status-icon');
        }

        this._baseStyle = baseStyle;
        this._hoverStyle = hoverStyle;
        this._updateHoverState();
    }

    // Hover fires per pointer pass, so it only swaps precomputed strings.
    _updateHoverState() {
        if (!this.actor)
            return;
        this.actor.set_style(this.actor.hover ? this._hoverStyle : this._baseStyle);
    }

    _applyStoredConfig() {
        if (!this.appId || this._isDestroyed)
            return;
        const hidden = getAppConfigValue(this._settings, this.appId, 'is_hidden', false);
        if (this.actor)
            this.actor.visible = !hidden;
    }

    async _updateIcon() {
        if (this._isDestroyed || !this._proxy || !this._iconActor)
            return;

        const {gicon, iconName, detected, pixmapHash} = await resolveTrayIcon(
            this._proxy,
            this._settings,
            this.appId,
            this._pixmapHash
        );

        if (this._isDestroyed)
            return;

        this._pixmapHash = pixmapHash ?? null;

        if (gicon) {
            this._iconActor.icon_name = null;
            this._iconActor.set_gicon(gicon);
        } else if (iconName) {
            this._iconActor.set_gicon(null);
            this._iconActor.icon_name = iconName;
        } else {
            this._iconActor.set_gicon(null);
            this._iconActor.icon_name = 'image-missing';
        }

        if (this.appId && detected?.iconName) {
            const updateData = {detected_icon: detected.iconName};
            if (detected.iconThemePath)
                updateData.icon_theme_path = detected.iconThemePath;
            updateAppConfig(this._settings, this.appId, updateData);
        }
    }

    async _updateTitle() {
        if (this._isDestroyed)
            return;

        const customTitle = getAppConfigValue(this._settings, this.appId, 'custom_title');
        if (customTitle) {
            const showTooltip = this._settings.get_boolean('enable-tooltips');
            if (this.actor)
                this.actor.accessible_name = showTooltip ? customTitle : '';
            if (this._tooltip)
                this._tooltip.text = customTitle;
            return;
        }

        if (!this._proxy)
            return;

        let title = await refreshPropertyOnProxy(this._proxy, 'Title');

        if (this._isDestroyed)
            return;
        const freshCustom = getAppConfigValue(this._settings, this.appId, 'custom_title');
        if (freshCustom)
            title = freshCustom;

        if (!title && this.appId)
            title = this.appId;
        if (!title)
            title = this.busName;
        if (title)
            title = formatAppName(title);

        const showTooltip = this._settings.get_boolean('enable-tooltips');
        if (this.actor)
            this.actor.accessible_name = showTooltip && title ? title : '';
        if (this._tooltip)
            this._tooltip.text = title;
    }

    async _updateMenuPath() {
        if (this._isDestroyed || !this._proxy)
            return;
        this._menuPath = await refreshPropertyOnProxy(this._proxy, 'Menu');
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
                this._menu?.destroy();
                return;
            }

            this._presentMenu();
        } catch (e) {
            warn(`Failed to open context menu for ${this.id}: ${e.message}`);
            if (this._menu) {
                this._menu.destroy();
                this._menu = null;
            }
        } finally {
            this._isMenuLoading = false;
        }
    }

    _fallbackToRemoteContextMenu() {
        if (!this._proxy?.ContextMenuRemote)
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
        await this._menuClient.init();
    }

    _createMenu() {
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }

        this._menu = new PopupMenu.PopupMenu(this._menuAnchor(), 0.5, St.Side.TOP);
        this._menu.actor.add_style_class_name('panel-menu');
        Main.layoutManager.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._menuManager.addMenu(this._menu);

        this._menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                this._lastCloseTime = GLib.get_monotonic_time();
        });
    }

    _presentMenu() {
        if (this._menu.length === 0) {
            this._menu.destroy();
            this._menu = null;
            return;
        }

        if (this._menu.setPosition)
            this._menu.setPosition(this._menuAnchor(), 0.5);
        this._menu.open(POPUP_ANIMATION_NONE);
        // ignoreRelease() was removed in GNOME Shell 45+.
        this._menuManager.ignoreRelease?.();
    }

    // Icons inside the overflow popup can't anchor the menu to themselves:
    // that anchor chain ends in uiGroup, and intellihide panels like Dash
    // to Panel then treat the menu grab as foreign and slide the panel
    // away, taking the menu with it. The shell's dummy cursor placed on
    // the icon's screen rect anchors identically and counts as a held grab.
    _menuAnchor() {
        if (Main.panel.contains(this.actor))
            return this.actor;

        const [x, y] = this.actor.get_transformed_position();
        const [w, h] = this.actor.get_transformed_size();
        Main.layoutManager.setDummyCursorGeometry(x, y, w, h);
        return Main.layoutManager.dummyCursor;
    }

    destroy() {
        if (this._isDestroyed)
            return;
        this._isDestroyed = true;

        disposeAll(this, 'destroy', '_draggable', '_clickController', '_tooltip');
        disconnectSignal(this, this._settings, '_settingsConnectId');
        clearIds(this, removeTimer, '_updateDeferId');

        if (this._proxy) {
            disconnectAll(this, this._proxy, '_proxySignals', 'disconnectSignal');
            disconnectAll(this, this._proxy, '_gObjectSignals');
        }

        // Menu actor may already have been C-disposed during shutdown.
        if (this._menu && !isDisposed(this._menu.actor))
            this._menu.destroy();
        this._menu = null;
        disposeAll(this, 'destroy', '_menuClient');
        this._menuManager = null;

        if (this.actor && !isDisposed(this.actor))
            this.actor.destroy();
        this.actor = null;

        this._onDestroy?.(this.id);
        this._proxy = null;
    }
}
