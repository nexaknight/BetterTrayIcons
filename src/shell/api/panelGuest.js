import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {API_MARKER, API_VERSION, BETTER_PANEL_UUID} from '../../shared/api/ids.js';
import {disconnectSignal} from '../../shared/lifecycle.js';
import {warn} from '../../shared/logging.js';
import {ICON_SIZE_RANGE_PX, BORDER_RADIUS_MAX_PX, BORDER_WIDTH_MAX_PX} from '../../const.js';

// What Better Panel shows for us, a catalog row and a settings page built from
// this data alone. No create(), the host finds our indicator in
// Main.panel.statusArea and moves it.
const APPLET = {
    id: 'tray',
    area: 'right',
    icon: 'bti-grid-symbolic',
    title: () => _('Tray Icons'),

    // Our keys span several prefixes, the host gets the one family that
    // covers an applet.
    keyPrefix: 'icon-',

    settings: [{
        group: () => _('Tray icons'),
        rows: [
            {type: 'spin', key: 'size', title: () => _('Icon size'), ...ICON_SIZE_RANGE_PX},
            {type: 'spin', key: 'border-radius', title: () => _('Corner radius'), min: 0, max: BORDER_RADIUS_MAX_PX},
            {type: 'spin', key: 'border-width', title: () => _('Border width'), min: 0, max: BORDER_WIDTH_MAX_PX},
            {type: 'spacing', title: () => _('Spacing')},
        ],
    }],
};

export class PanelGuest {
    // The peer may load before or after us, and a rebase runs disable() and
    // enable() without a state change, so we look on every change and once now.
    enable(extension) {
        this._extension = extension;
        this._stateChangedId = Main.extensionManager.connect(
            'extension-state-changed', () => this._joinPanel());
        this._joinPanel();
    }

    _joinPanel() {
        const api = Extension.lookupByUUID(BETTER_PANEL_UUID)?.api;
        if (api?.marker !== API_MARKER || api.version < API_VERSION)
            return;

        // The same api object means our registration still stands, a rebase
        // hands out a new object without a state change.
        if (this._api === api)
            return;

        // Set before the call, a refusing peer is asked once per api object.
        this._api = api;

        try {
            // A host guessing ~/.local misses system and Flatpak installs.
            this._appletId = api.registerApplet(this._extension.uuid, {
                ...APPLET,
                schemaId: this._extension.metadata['settings-schema'],
                schemaDir: this._extension.dir.get_child('schemas').get_path(),
            });
        } catch (e) {
            warn(`Better Panel refused the tray applet: ${e.message}`);
        }
    }

    disable() {
        disconnectSignal(this, Main.extensionManager, '_stateChangedId');
        if (this._appletId && Extension.lookupByUUID(BETTER_PANEL_UUID)?.api === this._api) {
            try {
                this._api.unregisterApplet(this._appletId);
            } catch (e) {
                // A peer throwing while it rebuilds its panel must not stop our teardown.
                warn(`Better Panel threw while taking the tray applet out: ${e.message}`);
            }
        }
        this._api = null;
        this._appletId = null;
        this._extension = null;
    }
}
