import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Mtk from 'gi://Mtk';
import St from 'gi://St';

import {displayAppName, getAppConfigMap, getAppConfigValue, updateAppConfig, reseedIfForgotten} from '../../shared/appConfig.js';
import {configuredIcon} from '../icons/iconResolver.js';
import {setIconContent} from '../icons/iconContent.js';
import {clearIds, disconnectSignal, disconnectAll, disposeAll, removeTimer, ruleDispatcher} from '../../shared/lifecycle.js';
import {DRAG_SETTING_KEYS, setupIconDragSource, syncDragEnabled} from '../features/dragAndDrop.js';
import {applyTitle, createTrayActor, syncTooltip} from '../features/tooltip.js';
import {applyIconChrome, connectColorSetChanges, syncHoverStyle, trayIconStyleFor} from '../trayStyle.js';
import {connectSurfaceChanges} from '../actorPlacement.js';
import {isDisposed} from '../disposal.js';
import {deriveAppMeta, prefixWindowsInFront} from './wineIdentity.js';
import {inFrontWindowActionFor} from '../features/launcherEntries.js';
import {TRAY_STYLE_KEYS} from '../../const.js';
import {withLightTwins} from '../../shared/colorVariant.js';

// icon-size restyles through its own rule below, listing it here would run
// _updateStyle twice per change.
const XEMBED_EXCLUDED_STYLE_KEYS = new Set([
    'icon-size',
    ...withLightTwins(['icon-color', 'icon-hover-color']),
]);

const XEMBED_STYLE_KEYS = TRAY_STYLE_KEYS.filter(key => !XEMBED_EXCLUDED_STYLE_KEYS.has(key));

const RIGHT_MOUSE_BUTTON = 3;

const MIN_EMBED_WINDOW_PX = 1;

let _wrapperSerial = 0;

export class XEmbedTrayIcon {
    static async create(rawIcon, settings, onDestroy, onAfterClick, onDragStateChange = null, cancellable = null) {
        const meta = await deriveAppMeta(rawIcon, cancellable);
        return new XEmbedTrayIcon(rawIcon, meta, settings, onDestroy, onAfterClick, onDragStateChange);
    }

    constructor(rawIcon, meta, settings, onDestroy, onAfterClick, onDragStateChange = null) {
        this._icon = rawIcon;
        this._settings = settings;
        this._onDestroy = onDestroy;
        this._onAfterClick = onAfterClick;
        this._onDragStateChange = onDragStateChange;
        this._isDestroyed = false;
        this._pendingClickId = 0;
        this._actorSignals = [];
        this._settingsSignals = [];
        this._draggable = null;
        this._tooltip = null;

        this.appId = meta.appId;
        this._metaTitle = meta.title;
        this._wineKey = meta.wineKey;
        this.id = `xembed:${this.appId ?? 'unknown'}:${rawIcon.pid}:${++_wrapperSerial}`;

        const {actor, tooltip} = createTrayActor(this._settings);
        this.actor = actor;
        this._tooltip = tooltip;
        this.actor._appId = this.appId;
        this.actor._isXembed = true;
        this.actor._trayAction = (action, event, anchor = this.actor) => this._forwardRowClick(action, event, anchor);
        // The menu lives in the Win32 app, a row hands the click on to it
        this.actor._trayFillMenu = () => false;
        this.actor._trayRestyle = () => this._updateStyle();

        this._iconBox = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._iconBox.add_child(rawIcon);
        // The embed moves wherever X needs its window, this clone keeps
        // showing the icon in its slot
        rawIcon.opacity = 0;
        this._iconView = new Clutter.Clone({
            source: rawIcon,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._iconBox.add_child(this._iconView);
        this.actor.set_child(this._iconBox);
        this._customIcon = null;
        this._customIconValue = null;

        this._applyIconSize();
        this._applyCustomIcon();
        this._updateStyle();
        this._connectSignals();
        this._setupDrag();

        this._identitySeed = {
            title: meta.title || this.appId,
            is_wine: meta.isWine,
            is_proton: meta.isProton,
            // The prefs use this to drop rows that only an SNI item can feed,
            // like the status icons.
            is_xembed: true,
        };
        updateAppConfig(settings, this.appId, this._identitySeed);
        this._updateTitle();
    }

    _connectSignals() {
        this._actorSignals.push(
            this.actor.connect('button-press-event', () => {
                this.actor.add_style_pseudo_class('active');
                this._syncEmbedPosition();
                return Clutter.EVENT_PROPAGATE;
            }),
            this.actor.connect('button-release-event', (_a, event) => {
                this.actor.remove_style_pseudo_class('active');
                const isRightClick = event.get_button() === RIGHT_MOUSE_BUTTON;
                this._forwardClick(event, isRightClick);
                this._onAfterClick(this.actor);
                return Clutter.EVENT_PROPAGATE;
            }),
            this.actor.connect('leave-event', () => {
                this.actor.remove_style_pseudo_class('active');
                syncHoverStyle(this.actor);
                return Clutter.EVENT_PROPAGATE;
            }),
            this.actor.connect('notify::hover', () => {
                if (this.actor.hover)
                    this._syncEmbedPosition();
                syncHoverStyle(this.actor);
                syncTooltip(this.actor, this._tooltip, this._settings);
            })
        );

        this._sigIconDestroy = this._icon.connect('destroy', () => {
            this._sigIconDestroy = 0;
            this.destroy();
        });

        const rules = [
            {
                match: key => key === 'icon-size', run: () => {
                    this._applyIconSize();
                    this._updateStyle();
                },
            },
            {match: key => XEMBED_STYLE_KEYS.includes(key), run: () => this._updateStyle()},
            {
                match: key => key === 'app-configs', run: () => {
                    reseedIfForgotten(this._settings, this.appId, this._identitySeed);
                    this._updateTitle();
                    this._applyCustomIcon();
                },
            },
            {match: key => key === 'enable-tooltips', run: () => this._updateTitle()},
            {
                match: key => key === 'enable-symbolic-icons', run: () => {
                    this._customIconValue = null;
                    this._applyCustomIcon();
                },
            },
            {match: key => DRAG_SETTING_KEYS.includes(key), run: () => syncDragEnabled(this._draggable, this._settings)},
        ];

        this._settingsSignals.push(this._settings.connect('changed', ruleDispatcher(rules)));
        this._colorSetWatch = connectColorSetChanges(this._settings, () => this._updateStyle());
        connectSurfaceChanges(this.actor, () => this._updateStyle());
    }

    _setupDrag() {
        this._draggable = setupIconDragSource({
            actor: this.actor,
            appId: this.appId,
            settings: this._settings,
            tooltip: this._tooltip,
            onForwardedDragStateChange: this._onDragStateChange,
        });
    }

    // The embedded window only understands pointer clicks, a key press on a
    // Background Apps row has nothing to forward.
    _forwardRowClick(action, event, anchor) {
        const type = event?.type();
        if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.BUTTON_RELEASE)
            return;
        this._forwardClick(event, action === 'menu');
        this._onAfterClick(anchor);
    }

    // Right click waits for an idle so Mutter has released its implicit grabs
    // before Wine raises its context menu. That covers the click race on X11,
    // not the XWayland XGrabPointer issue.
    _forwardClick(event, isRightClick) {
        if (!isRightClick) {
            this._forwardLeftClick(event);
            return;
        }
        // Clutter recycles event objects, so copy before deferring.
        const eventCopy = event.copy();
        clearIds(this, removeTimer, '_pendingClickId');
        this._pendingClickId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pendingClickId = 0;
            if (!this._isDestroyed)
                this._icon.click(eventCopy);
            return GLib.SOURCE_REMOVE;
        });
    }

    // The shell hands X the icon's stage position, but XWayland reads X
    // positions in scaled pixels. Above 100 % the embed window, and the menu
    // the app opens next to it, land at a fraction of the icon's position.
    // Source: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/src/shell-tray-icon.c
    _syncEmbedPosition() {
        const window = this._icon.source?.meta_window;
        if (!window)
            return;
        const [stageX, stageY] = this._icon.get_transformed_position();
        const [width, height] = this._icon.get_transformed_size();
        const slot = new Mtk.Rectangle({
            x: Math.round(stageX - this._icon.translation_x),
            y: Math.round(stageY - this._icon.translation_y),
            width: Math.round(width),
            height: Math.round(height),
        });
        const target = window.stage_to_protocol_rect(slot);
        const offsetX = target.x - slot.x;
        const offsetY = target.y - slot.y;
        const isInPlace = offsetX === this._icon.translation_x && offsetY === this._icon.translation_y;
        if (isInPlace)
            return;
        this._icon.set_translation(offsetX, offsetY, 0);
        // The shell passes the position on to X from its allocate
        this._icon.queue_relayout();
    }

    _forwardLeftClick(event) {
        const inFrontAction = inFrontWindowActionFor(this._settings, this.appId);
        if (!inFrontAction || event.get_button() !== Clutter.BUTTON_PRIMARY) {
            this._icon.click(event);
            return;
        }
        const eventCopy = event.copy();
        this._windowsInFront().then(windows => {
            if (this._isDestroyed)
                return;
            const frontWindow = global.display.focus_window;
            if (windows?.includes(frontWindow))
                inFrontAction(windows, frontWindow);
            else
                this._icon.click(eventCopy);
        });
    }

    // A Wine tray mostly belongs to a helper process, so its windows come
    // through the prefix. Any other X11 tray app owns its windows itself.
    _windowsInFront() {
        if (this._wineKey)
            return prefixWindowsInFront(this._wineKey, this._icon.pid, null);
        return Promise.resolve(global.display.list_all_windows().filter(window => window.get_pid() === this._icon.pid));
    }

    _applyIconSize() {
        const size = this._settings.get_int('icon-size');
        // X answers a 0x0 window with BadValue, and that error aborts the
        // shell. The window keeps one pixel and hides instead.
        const windowSize = Math.max(size, MIN_EMBED_WINDOW_PX);
        this._icon.set({
            width: windowSize,
            height: windowSize,
            visible: size > 0,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._iconView.visible = size > 0 && !this._customIcon;
        if (this._customIcon) {
            this._customIcon.icon_size = size;
            this._customIcon.visible = size > 0;
        }
    }

    // A custom icon takes the clone's place. The embed stays allocated to
    // keep click forwarding and the app's idea of an embedded icon alive.
    _applyCustomIcon() {
        const value = getAppConfigValue(this._settings, this.appId, 'custom_icon');
        if (value === this._customIconValue)
            return;
        this._customIconValue = value;

        disposeAll(this, 'destroy', '_customIcon');
        if (value) {
            this._customIcon = new St.Icon({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            setIconContent(this._customIcon, configuredIcon(value, this._settings));
            this._iconBox.add_child(this._customIcon);
        }
        this._applyIconSize();
    }

    _updateStyle() {
        if (this._isDestroyed)
            return;

        const {enableCustom, baseStyle, hoverStyle} = trayIconStyleFor(this.actor, this._settings, {withColors: false});
        applyIconChrome(this.actor, this._settings, enableCustom);

        this.actor._baseStyle = baseStyle;
        this.actor._hoverStyle = hoverStyle;
        syncHoverStyle(this.actor);
    }

    _updateTitle() {
        const config = getAppConfigMap(this._settings)[this.appId] ?? {};
        const title = displayAppName(config, this.appId || this._metaTitle);
        applyTitle(this.actor, this._tooltip, this._settings, title);
    }

    destroy() {
        if (this._isDestroyed)
            return;
        this._isDestroyed = true;

        disposeAll(this, 'destroy', '_draggable', '_tooltip');
        clearIds(this, removeTimer, '_pendingClickId');
        disconnectAll(this, this._settings, '_settingsSignals');
        disposeAll(this, 'disconnect', '_colorSetWatch');
        disconnectAll(this, this.actor, '_actorSignals');
        disconnectSignal(this, this._icon, '_sigIconDestroy');

        this._onDestroy(this.id);

        if (!isDisposed(this.actor))
            this.actor.destroy();
        this.actor = null;
        this._icon = null;
    }
}
