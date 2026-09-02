import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getAppConfigs, deleteAppConfig, resetAllAppConfigs, displayAppName} from '../../shared/appConfig.js';
import {connectScoped, clearIds, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {resolveIcon, probeIconPaths, themeProbeKey, tintedSymbolicIconMap} from '../../shared/iconLoading.js';
import AppDialog from '../dialogs/appDialog.js';
import {createButton, createIconButton} from '../components/button.js';
import {createImage} from '../components/image.js';
import {applyResolvedIcon, devicePixelSize, hasThemeIcon, prefsSymbolicTint, themeIconFile, NEXT_ICON_NAME} from '../components/icon.js';
import {createActionRow} from '../components/row.js';
import {addToast} from '../components/sidebar.js';
import {showConfirmationDialog} from '../components/dialog.js';

const PAGE_REBUILD_DEBOUNCE_MS = 100;

const ROW_ICON_PX = 32;

// A forgotten app that is still running keeps its cached icon until the shell
// re-resolves it, several awaited D-Bus round trips later. A shorter gap lets
// the next deletion's app-configs write race that chain and strand
// cached_icon_path on a file no snapshot ever wrote, OpenRGB does just that.
const APP_FORGET_STAGGER_MS = 500;

// Product names, so nothing to translate.
const PACKAGING_LABELS = Object.freeze({
    snap: 'Snap',
    flatpak: 'Flatpak',
    appimage: 'AppImage',
});

// Generic IDs from before identifyApp picked stable process names.
const LEGACY_ID_PATTERNS = Object.freeze([
    /^chrome_status_icon_\d+$/,
    /^_\d+_/,
    /StatusNotifierItem/,
    /^xembed-\d+$/,
]);

export class ApplicationsPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsApplicationsPage'}, this);
    }

    _init(window, settings) {
        super._init({
            title: _('Applications'),
            icon_name: 'bti-apps-symbolic',
        });

        this._window = window;
        this._settings = settings;
        this._appsGroup = null;
        this._rebuildTimeoutId = 0;
        this._buildGeneration = 0;

        this._headerActions = null;
        this._buildUI();

        // One edit can fire several app-configs writes in a row (rename
        // debounce, priority spinner, detection updates from the shell).
        const queueRebuild = () =>
            debounceTo(this, '_rebuildTimeoutId', PAGE_REBUILD_DEBOUNCE_MS, () => this._buildUI());
        connectScoped(this, this._settings, 'changed::app-configs', queueRebuild);
        // The rows read this once while building, so without a rebuild they
        // keep whichever variant was current when the page was opened.
        connectScoped(this, this._settings, 'changed::enable-symbolic-icons', queueRebuild);
    }

    get headerActions() {
        this._headerActions ??= this._buildHeaderActions();
        return this._headerActions;
    }

    // Probing before the teardown leaves the current list up on a slow mount
    // instead of an empty page. Dispose bumps the generation counter below
    // to drop an overtaken probe instead of rendering into a dead page.
    _buildUI() {
        const gen = ++this._buildGeneration;
        const apps = getAppConfigs(this._settings);
        apps.sort((a, b) => displayAppName(a, a.id)
            .localeCompare(displayAppName(b, b.id), undefined, {sensitivity: 'base'}));

        probeIconPaths(apps).then(async iconPaths => {
            const tintedIcons = await this._tintIcons(apps, iconPaths);
            if (gen === this._buildGeneration)
                this._renderApps(apps, iconPaths, tintedIcons);
        });
    }

    _tintIcons(apps, iconPaths) {
        return tintedSymbolicIconMap(
            apps.map(app => this._resolveFor(app, iconPaths).value),
            prefsSymbolicTint(this._settings),
            {size: devicePixelSize(this, ROW_ICON_PX), lookupThemeFile: themeIconFile});
    }

    _resolveFor(app, iconPaths) {
        const themeKey = themeProbeKey(app);
        return resolveIcon(app, hasThemeIcon, iconPaths.get(app.cached_icon_path),
            themeKey ? iconPaths.get(themeKey) : null);
    }

    _renderApps(apps, iconPaths, tintedIcons) {
        this._iconPaths = iconPaths;
        this._tintedIcons = tintedIcons;
        if (this._appsGroup) {
            this.remove(this._appsGroup);
            this._appsGroup = null;
        }

        this._appsGroup = new Adw.PreferencesGroup({
            title: _('Detected Apps'),
            description: _('Settings persist after the app closes.'),
        });
        this.add(this._appsGroup);

        if (apps.length === 0) {
            this._appsGroup.add(createActionRow({
                title: _('No apps detected'),
                subtitle: _('Run an app with a tray icon to see it here.'),
                prefixIcon: 'bti-search-symbolic',
            }));
            return;
        }

        const useSymbolic = this._settings.get_boolean('enable-symbolic-icons');

        apps.forEach(app => {
            const displayName = displayAppName(app, app.id);

            const iconImage = createImage({pixel_size: ROW_ICON_PX});
            // Wine and Proton render through XEmbed, whose X11 surface the prefs
            // cannot snapshot, so the list shows a flavor glyph instead.
            if (app.is_proton) {
                iconImage.set_from_icon_name('bti-proton-symbolic');
            } else if (app.is_wine) {
                iconImage.set_from_icon_name('bti-wine-symbolic');
            } else {
                const resolved = this._resolveFor(app, iconPaths);
                applyResolvedIcon(iconImage, resolved, useSymbolic, iconPaths,
                    tintedIcons.get(resolved.value));
            }

            let flavor = PACKAGING_LABELS[app.packaging];
            if (app.is_proton)
                flavor = _('Proton');
            else if (app.is_wine)
                flavor = _('Wine');

            const hiddenMark = app.is_hidden
                ? [createIconButton('bti-hidden-symbolic', {tooltip: _('Hidden'), sensitive: false})]
                : [];

            const badges = flavor ? [{text: flavor, variant: 'info'}] : [];
            if (app.is_background_proxy)
                badges.push({text: _('Background App'), variant: 'info'});

            this._appsGroup.add(createActionRow({
                title: displayName || _('Unknown App'),
                subtitle: `${_('ID')}: ${app.id}`,
                prefixWidget: iconImage,
                badge: badges,
                suffixWidgets: hiddenMark,
                suffixIcon: NEXT_ICON_NAME,
                onActivate: () => this._openAppConfiguration(app),
            }));
        });

        const hasLegacy = apps.some(a => isLegacyAppId(a.id));

        if (hasLegacy) {
            const cleanupButton = createButton({
                label: _('Clean Up'),
                cssClasses: ['suggested-action'],
                valign: 'center',
            });
            cleanupButton.connect('clicked', () => this._cleanupLegacyIds(apps));
            this._appsGroup.add(createActionRow({
                title: _('Clean Up Legacy IDs'),
                subtitle: _('Remove leftovers from earlier versions.'),
                suffixWidgets: [cleanupButton],
                activatable: true,
            }));
        }
    }

    _openAppConfiguration(appData) {
        const dialog = new AppDialog(this._settings, appData.id, appData, this._iconPaths, {
            onForget: () => addToast(this._window, new Adw.Toast({title: _('App forgotten')})),
        });
        dialog.present(this._window);
    }

    _cleanupLegacyIds(apps) {
        _deleteAppConfigsStaggered(this._settings, apps.filter(a => isLegacyAppId(a.id)).map(a => a.id));
    }

    _buildHeaderActions() {
        const box = new Gtk.Box({spacing: 6});
        box.append(createIconButton('bti-trash-symbolic', {
            tooltip: _('Forget All Apps'),
            onClick: () => this._confirmForgetAll(),
        }));
        box.append(createIconButton('bti-reset-symbolic', {
            circular: false,
            tooltip: _('Reset All Apps'),
            onClick: () => this._confirmResetAll(),
        }));
        return box;
    }

    _confirmForgetAll() {
        showConfirmationDialog(this._window, {
            title: _('Forget all apps?'),
            message: _('Deletes all stored settings for every detected app. Running apps are re-detected right away.'),
            confirmLabel: _('Forget All'),
            destructive: true,
            onConfirm: () => this._forgetAll(),
        });
    }

    _forgetAll() {
        const ids = getAppConfigs(this._settings).map(app => app.id);
        _deleteAppConfigsStaggered(this._settings, ids, () =>
            addToast(this._window, new Adw.Toast({title: _('All apps forgotten')})));
    }

    _confirmResetAll() {
        showConfirmationDialog(this._window, {
            title: _('Reset all apps?'),
            message: _('Restores name, icon and status icons to defaults for every detected app. Their order is kept.'),
            confirmLabel: _('Reset All'),
            destructive: true,
            onConfirm: () => this._resetAll(),
        });
    }

    _resetAll() {
        resetAllAppConfigs(this._settings);
        addToast(this._window, new Adw.Toast({title: _('All apps reset')}));
    }

    vfunc_dispose() {
        this._buildGeneration++;
        clearIds(this, removeTimer, '_rebuildTimeoutId');
        super.vfunc_dispose();
    }
}

function isLegacyAppId(id) {
    return LEGACY_ID_PATTERNS.some(pattern => pattern.test(id));
}

function _deleteAppConfigsStaggered(settings, appIds, onComplete) {
    const [next, ...rest] = appIds;
    if (!next) {
        onComplete?.();
        return;
    }
    deleteAppConfig(settings, next);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, APP_FORGET_STAGGER_MS, () => {
        _deleteAppConfigsStaggered(settings, rest, onComplete);
        return GLib.SOURCE_REMOVE;
    });
}

