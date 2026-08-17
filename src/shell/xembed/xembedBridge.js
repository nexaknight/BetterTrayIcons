import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {warn, error} from '../../shared/logging.js';
import {isCancelledError} from '../../shared/fetch.js';
import {getAppConfigMap} from '../../shared/appConfig.js';
import {disconnectSignal, disconnectAll} from '../../shared/lifecycle.js';
import {forwardDragStateToIndicator} from '../features/dragAndDrop.js';
import {clearIdentityCaches} from './wineIdentity.js';
import {XEmbedTrayIcon} from './xembedTrayIcon.js';

// Matches the shell's .popup-menu-content background.
const XEMBED_BG_FALLBACK_HEX = '#36363A';

export class XEmbedTrayBridge {
    constructor(settings, panelIndicator) {
        this._settings = settings;
        this._panelIndicator = panelIndicator;
        this._tray = null;
        this._wrappers = new Map();
        this._pendingCreates = new Map();
        this._traySignals = [];
        this._bgSignalIds = [];
        this._enableSignalId = 0;
        this._lastBgCss = null;
    }

    enable() {
        this._enableSignalId = this._settings.connect(
            'changed::enable-wine-support', () => this._sync());
        this._sync();
    }

    // Toggling the setting only flips wrapper visibility. unmanage_screen()
    // would force every Wine client to drop its tray icon, and most Wine
    // builds don't re-register on the MANAGER ClientMessage when reclaimed.
    _sync() {
        const enabled = this._settings.get_boolean('enable-wine-support');
        if (enabled && !this._tray)
            this._start();
        // Respect is_hidden here too, the layout pass corrects it only
        // after its debounce and user-hidden icons would flash visible.
        const configMap = getAppConfigMap(this._settings);
        for (const wrapper of this._wrappers.values())
            wrapper.actor.visible = enabled && !configMap[wrapper.appId]?.is_hidden;
    }

    _start() {
        if (this._tray)
            return;

        try {
            this._tray = new Shell.TrayManager({bgColor: this._resolveBgColor()});
        } catch (e) {
            error('XEmbedTrayBridge: failed to construct Shell.TrayManager', e);
            return;
        }

        this._traySignals.push(this._tray.connect('tray-icon-added',
            (_t, icon) => this._onIconAdded(icon)));
        this._traySignals.push(this._tray.connect('tray-icon-removed',
            (_t, icon) => this._onIconRemoved(icon)));

        // manage_screen claims the X11 system-tray selection. It returns
        // void, losing the race against another running tray fails silently.
        this._tray.manage_screen(Main.panel);

        // bgColor is baked into each XEmbed child at construct time, so the
        // TrayManager has to be rebuilt on a color change.
        this._bgSignalIds = [
            this._settings.connect('changed::overflow-container-background-color',
                () => this._rebuildIfBgColorChanged()),
            this._settings.connect('changed::enable-custom-overflow-style',
                () => this._rebuildIfBgColorChanged()),
        ];
        this._lastBgCss = this._preferredBgCss();
    }

    _rebuildIfBgColorChanged() {
        if (!this._tray)
            return;
        const next = this._preferredBgCss();
        if (next === this._lastBgCss)
            return;
        this._lastBgCss = next;
        this._stop();
        this._start();
    }

    _resolveBgColor() {
        const css = this._preferredBgCss();
        return parseCssColor(css) ?? getFallbackBgColor();
    }

    _preferredBgCss() {
        if (this._settings.get_boolean('enable-custom-overflow-style')) {
            const css = this._settings.get_string('overflow-container-background-color');
            if (css.trim().length > 0)
                return css;
        }
        return XEMBED_BG_FALLBACK_HEX;
    }

    _stop() {
        if (!this._tray)
            return;

        // Abort any in-flight wrapper creations so their awaits short-circuit
        // before they try to touch torn-down state.
        for (const cancellable of this._pendingCreates.values())
            cancellable.cancel();
        this._pendingCreates.clear();

        disconnectAll(this, this._settings, '_bgSignalIds');

        // Disconnect first. Otherwise wrapper teardown below triggers
        // tray-icon-removed events that we'd have to ignore.
        disconnectAll(this, this._tray, '_traySignals');

        for (const wrapper of this._wrappers.values())
            wrapper.destroy();
        this._wrappers.clear();

        this._tray.unmanage_screen();
        this._tray = null;
    }

    async _onIconAdded(rawIcon) {
        if (!rawIcon || this._wrappers.has(rawIcon) || this._pendingCreates.has(rawIcon))
            return;

        const cancellable = new Gio.Cancellable();
        this._pendingCreates.set(rawIcon, cancellable);

        let wrapper;
        try {
            wrapper = await XEmbedTrayIcon.create(
                rawIcon,
                this._settings,
                id => this._afterWrapperDestroyed(rawIcon, id),
                () => this._panelIndicator._handleIconClick(),
                forwardDragStateToIndicator(this._panelIndicator),
                cancellable
            );
        } catch (e) {
            if (!isCancelledError(e))
                warn(`XEmbedTrayBridge: wrapper create failed: ${e.message}`);
            return;
        } finally {
            this._pendingCreates.delete(rawIcon);
        }

        // Bridge state may have changed during async meta resolution: the bridge
        // could have been stopped, or a removed→added cycle could have raced past us.
        if (cancellable.is_cancelled() || !this._tray || this._wrappers.has(rawIcon)) {
            wrapper.destroy();
            return;
        }

        this._wrappers.set(rawIcon, wrapper);
        wrapper.actor.visible = this._settings.get_boolean('enable-wine-support');
        this._panelIndicator.addIcon(wrapper.id, wrapper.actor);
    }

    _onIconRemoved(rawIcon) {
        const cancellable = this._pendingCreates.get(rawIcon);
        if (cancellable) {
            cancellable.cancel();
            this._pendingCreates.delete(rawIcon);
        }
        this._wrappers.get(rawIcon)?.destroy();
    }

    _afterWrapperDestroyed(rawIcon, wrapperId) {
        this._wrappers.delete(rawIcon);
        this._panelIndicator.removeIcon(wrapperId);
    }

    disable() {
        disconnectSignal(this, this._settings, '_enableSignalId');
        this._stop();
        clearIdentityCaches();
    }
}

// The TrayManager's bg-color property is a CoglColor on GNOME 49/50.
function parseCssColor(css) {
    const [ok, parsed] = Cogl.color_from_string(css);
    return ok ? parsed : null;
}

let _bgFallbackColor;

function getFallbackBgColor() {
    if (_bgFallbackColor === undefined)
        _bgFallbackColor = parseCssColor(XEMBED_BG_FALLBACK_HEX);
    return _bgFallbackColor;
}
