import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getAppConfigs, deleteAppConfig, formatAppName} from '../../shared/appConfig.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {resolveIcon} from '../../shared/icon.js';
import AppDialog from '../dialogs/appDialog.js';
import {createButton, createIconButton, createImage, applyResolvedIcon, attachBadge} from '../widgets/gtkHelpers.js';
import {WINE_ICON_NAMES, LEGACY_ID_PATTERNS} from '../../const.js';

const isLegacyAppId = id => LEGACY_ID_PATTERNS.some(rx => rx.test(id));

export class ApplicationsPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    _init(window, settings) {
        super._init({
            title: _('Applications'),
            icon_name: 'view-app-grid-symbolic',
        });

        this._window = window;
        this._settings = settings;
        this._appsGroup = null;

        this._buildUI();

        connectScoped(this, this._settings, 'changed::app-configs', () => {
            this._buildUI();
        });
    }

    _buildUI() {
        if (this._appsGroup) {
            this.remove(this._appsGroup);
            this._appsGroup = null;
        }

        this._appsGroup = new Adw.PreferencesGroup({
            title: _('Detected Apps'),
            description: _('Settings persist after the app closes.'),
        });
        this.add(this._appsGroup);

        const apps = getAppConfigs(this._settings);

        if (apps.length === 0) {
            this._appsGroup.add(new Adw.ActionRow({
                title: _('No apps detected'),
                subtitle: _('Run an app with a tray icon to see it here.'),
                icon_name: 'system-search-symbolic',
            }));
            return;
        }

        apps.sort((a, b) => (a.title || a.id).toLowerCase().localeCompare((b.title || b.id).toLowerCase()));

        const useSymbolic = this._settings.get_boolean('enable-symbolic-icons');

        apps.forEach(app => {
            const displayName = formatAppName(app.custom_title || app.title || app.id);

            const row = new Adw.ActionRow({
                title: displayName || _('Unknown App'),
                subtitle: `ID: ${app.id}`,
                activatable: true,
            });

            const iconImage = createImage({pixel_size: 32});
            if (app.is_wine || app.is_proton) {
                iconImage.set_from_gicon(new Gio.ThemedIcon({
                    names: WINE_ICON_NAMES,
                    use_default_fallbacks: true,
                }));
            } else {
                applyResolvedIcon(iconImage, resolveIcon(app), useSymbolic);
            }

            row.add_prefix(iconImage);

            if (app.is_proton)
                attachBadge(row, _('Proton'), {variant: 'info'});
            else if (app.is_wine)
                attachBadge(row, _('Wine'), {variant: 'info'});


            if (app.is_hidden) {
                row.add_suffix(createIconButton('low-vision-symbolic', {
                    tooltip_text: _('Hidden'),
                    sensitive: false,
                }));
            }

            row.add_suffix(createImage({icon_name: 'go-next-symbolic'}));

            row.connect('activated', () => this._openAppConfiguration(app));
            this._appsGroup.add(row);
        });

        const hasLegacy = apps.some(a => isLegacyAppId(a.id));

        if (hasLegacy) {
            const cleanupRow = new Adw.ActionRow({
                title: _('Clean Up Legacy IDs'),
                subtitle: _('Remove leftovers from earlier versions.'),
                activatable: true,
            });
            const cleanupBtn = createButton({
                label: _('Clean Up'),
                cssClasses: ['suggested-action'],
                valign: 'center',
            });
            cleanupBtn.connect('clicked', () => this._cleanupLegacyIds(apps));
            cleanupRow.add_suffix(cleanupBtn);

            this._appsGroup.add(cleanupRow);
        }
    }

    _openAppConfiguration(appData) {
        const dialog = new AppDialog(this._settings, appData.id, appData);
        dialog.present(this._window);
    }

    _cleanupLegacyIds(apps) {
        apps.forEach(app => {
            if (isLegacyAppId(app.id))
                deleteAppConfig(this._settings, app.id);
        });
    }
}
