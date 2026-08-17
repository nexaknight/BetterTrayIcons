import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {displayAppName, getAppConfigMap, getAppConfigValue, updateAppConfig, reseedIfForgotten} from '../../shared/appConfig.js';
import {configuredIcon} from '../utils/icons.js';
import {clearIds, disconnectSignal, disconnectAll, disposeAll, removeTimer, ruleDispatcher} from '../../shared/lifecycle.js';
import {DRAG_SETTING_KEYS, setupIconDragSource, syncDragEnabled} from '../features/dragAndDrop.js';
import {applyTitle, createTrayActor, syncTooltip} from '../features/tooltip.js';
import {computeTrayIconStyle, applyPanelClasses, isDisposed, syncHoverStyle} from '../utils/actor.js';
import {deriveAppMeta} from './wineIdentity.js';
import {TRAY_STYLE_KEYS} from '../../const.js';

// icon-size restyles through its own rule below, listing it here would run
// _updateStyle twice per change. The foreground color keys are out per the
// withColors rationale in _updateStyle.
const XEMBED_EXCLUDED_STYLE_KEYS = new Set([
    'icon-size',
    'icon-color',
    'icon-hover-color',
    'icon-use-accent-color',
    'icon-hover-use-accent-color',
]);

const XEMBED_STYLE_KEYS = TRAY_STYLE_KEYS.filter(key => !XEMBED_EXCLUDED_STYLE_KEYS.has(key));

// Distinguishes wrappers whose appId and pid both collide: one explorer.exe
// owns every tray window of a prefix, so two apps there look identical.
let _wrapperSerial = 0;

export class XEmbedTrayIcon {
    // Meta resolution awaits async /proc and Steam manifest reads, so the
    // constructor stays synchronous.
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

        // Null when nothing identified the window, which leaves the icon
        // rendering but unconfigurable.
        this.appId = meta.appId;
        this._metaTitle = meta.title;
        // pid separates instances across prefixes, the serial separates apps
        // within one prefix.
        this.id = `xembed:${this.appId ?? 'unknown'}:${rawIcon.pid || 0}:${++_wrapperSerial}`;

        const {actor, tooltip} = createTrayActor(`XEmbedTrayIcon ${this.id}`, this._settings);
        this.actor = actor;
        this._tooltip = tooltip;
        this.actor._appId = this.appId;
        this.actor._isXembed = true;

        this._iconBox = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._iconBox.add_child(rawIcon);
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
        // XEmbed icons own their click semantics, so bypass ClickController
        // and forward directly through Shell.TrayIcon.click().
        this._actorSignals.push(
            this.actor.connect('button-press-event', () => {
                this.actor.add_style_pseudo_class('active');
                return Clutter.EVENT_PROPAGATE;
            }),
            this.actor.connect('button-release-event', (_a, event) => {
                this.actor.remove_style_pseudo_class('active');
                const isRightClick = event.get_button() === 3;
                this._forwardClick(event, isRightClick);
                this._onAfterClick();
                return Clutter.EVENT_PROPAGATE;
            }),
            this.actor.connect('leave-event', () => {
                this.actor.remove_style_pseudo_class('active');
                syncHoverStyle(this.actor);
                return Clutter.EVENT_PROPAGATE;
            }),
            this.actor.connect('notify::hover', () => {
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
    }

    _setupDrag() {
        this._draggable = setupIconDragSource({
            actor: this.actor,
            appId: this.appId,
            settings: this._settings,
            label: this.id,
            tooltip: this._tooltip,
            onForwardedDragStateChange: this._onDragStateChange,
        });
    }

    // Right click goes through GLib.idle_add so Mutter has released its
    // implicit grabs before Wine raises its context menu. This only
    // mitigates the click-race on X11, not the XWayland XGrabPointer issue.
    _forwardClick(event, isRightClick) {
        if (!isRightClick) {
            this._icon.click(event);
            return;
        }
        // Clutter recycles event objects, so copy before deferring.
        const eventCopy = event.copy();
        this._pendingClickId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pendingClickId = 0;
            if (!this._isDestroyed && this._icon)
                this._icon.click(eventCopy);
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyIconSize() {
        const size = this._settings.get_int('icon-size');
        this._icon.set({
            width: size,
            height: size,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (this._customIcon)
            this._customIcon.icon_size = size;
    }

    // SNI icons swap their custom icon inside resolveTrayIcon, an XEmbed
    // window paints itself, so cover it with a St.Icon instead. The window
    // stays allocated at opacity 0 to keep click forwarding and the app's
    // idea of an embedded icon alive.
    _applyCustomIcon() {
        if (this._isDestroyed)
            return;
        const value = getAppConfigValue(this._settings, this.appId, 'custom_icon');
        if (value === this._customIconValue)
            return;
        this._customIconValue = value;

        disposeAll(this, 'destroy', '_customIcon');
        this._icon.opacity = value ? 0 : 255;
        if (!value)
            return;

        this._customIcon = new St.Icon({
            gicon: configuredIcon(value, this._settings).gicon,
            icon_size: this._settings.get_int('icon-size'),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._iconBox.add_child(this._customIcon);
    }

    // Background-color only shows through the padding, which forms the hover
    // halo: the embedded X11 window paints over the rest.
    _updateStyle() {
        if (this._isDestroyed)
            return;

        const {enableCustom, baseStyle, hoverStyle} = computeTrayIconStyle(this._settings, {withColors: false});
        applyPanelClasses(this.actor, null, enableCustom);

        this.actor._baseStyle = baseStyle;
        this.actor._hoverStyle = hoverStyle;
        syncHoverStyle(this.actor);
    }

    // XEmbed has no tooltip protocol and Wine leaves the icon window's
    // WM_NAME empty, so the tooltip falls back to the resolved app name.
    _updateTitle() {
        if (this._isDestroyed)
            return;
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
        disconnectAll(this, this.actor, '_actorSignals');
        disconnectSignal(this, this._icon, '_sigIconDestroy');

        this._onDestroy(this.id);

        if (!isDisposed(this.actor))
            this.actor.destroy();
        this.actor = null;
        this._icon = null;
    }
}
