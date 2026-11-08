import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getAppConfigs, deleteAppConfig, resetAllAppConfigs, displayAppName, readShownIcons} from '../../shared/appConfig.js';
import {clearIds, connectScoped, debounceTo, removeTimer, watchKeys} from '../../shared/lifecycle.js';
import {probeIconPaths, themeProbeKey, tintedSymbolicIconMap} from '../../shared/iconLoading.js';
import AppDialog from '../dialogs/appDialog.js';
import {GONE_ICON_NAME, probeGoneApps} from '../appPresence.js';
import {createButton, createIconButton, createMenuButton} from '../components/button.js';
import {createImage} from '../components/image.js';
import {createBadgeLine, setBadges} from '../components/badge.js';
import {applyIconPreview, applyResolvedIcon, devicePixelSize, prefsSymbolicTint, resolveAppIcon, themeIconFile, tintSource, watchShownIcons, NEXT_ICON_NAME, RESET_ICON_NAME} from '../components/icon.js';
import {createActionRow, createBadgedActionRow} from '../components/row.js';
import {addToast} from '../components/sidebar.js';
import {showConfirmationDialog} from '../components/dialog.js';
import {TokenSearch} from '../components/search.js';

const PAGE_REBUILD_DEBOUNCE_MS = 100;

const ROW_ICON_PX = 32;

const BADGES_KEY = 'applications-show-badges';
const FILTER_KEY = 'applications-show-filter';

// A forgotten app that is still running keeps its cached icon until the shell
// re-resolves it, several D-Bus round trips later. A shorter gap lets the
// next deletion's write strand cached_icon_path, as OpenRGB does.
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
        this._forgetTimeoutId = 0;
        this._buildGeneration = 0;
        this._shownIcons = {};
        this._appRows = new Map();
        this._goneIds = new Set();

        this._headerActions = null;
        this.actions = [{
            iconName: 'bti-search-symbolic',
            tooltip: _('Search'),
            activeIconName: 'bti-search-symbolic',
            activeTooltip: _('Hide Search'),
            settings,
            key: FILTER_KEY,
        }, {
            iconName: 'bti-tag-symbolic',
            tooltip: _('Show Badges'),
            activeIconName: 'bti-tag-x-symbolic',
            activeTooltip: _('Hide Badges'),
            settings,
            key: BADGES_KEY,
        }];
        this._buildFilterBar();
        this._buildUI();

        // One edit can fire several app-configs writes in a row (rename
        // debounce, priority spinner, detection updates from the shell).
        const queueRebuild = () =>
            debounceTo(this, '_rebuildTimeoutId', PAGE_REBUILD_DEBOUNCE_MS, () => this._buildUI());
        connectScoped(this, this._settings, 'changed::app-configs', queueRebuild);
        // The rows read this once while building, so without a rebuild they
        // keep whichever variant was current when the page was opened.
        connectScoped(this, this._settings, 'changed::enable-symbolic-icons', queueRebuild);
        watchShownIcons(this, shown => this._applyShownIcons(shown));

        this.connect('unrealize', () =>
            clearIds(this, removeTimer, '_rebuildTimeoutId', '_forgetTimeoutId'));
    }

    get headerActions() {
        this._headerActions ??= createMenuButton({
            iconName: 'bti-ellipsis-vertical-symbolic',
            tooltip: _('More Actions'),
            items: [{
                iconName: 'bti-trash-symbolic',
                label: _('Forget All Apps'),
                onActivate: () => this._confirmForgetAll(),
            }, {
                iconName: RESET_ICON_NAME,
                label: _('Reset All Apps'),
                onActivate: () => this._confirmResetAll(),
            }],
        });
        return this._headerActions;
    }

    // Its own group above the list, so a rebuild of the list keeps the chips
    // and the typed text
    _buildFilterBar() {
        this._search = new TokenSearch({placeholder: _('Search apps')});
        this._search.connect('changed', () => this._applyFilter());
        this._filterRevealer = new Gtk.Revealer({
            child: this._search,
            transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
        });
        this._filterGroup = new Adw.PreferencesGroup();
        this._filterGroup.add(this._filterRevealer);
        this.add(this._filterGroup);

        // Its own group, inside the list group the empty boxed list would
        // still draw its frame above it
        this._noMatchGroup = new Adw.PreferencesGroup({visible: false});
        this._noMatchGroup.add(new Adw.StatusPage({
            icon_name: 'bti-search-symbolic',
            title: _('No Matching Apps'),
            description: _('Try a different search term.'),
        }));
        this.add(this._noMatchGroup);

        // A hidden group still takes the page's gap between groups, so it
        // only shows while the bar is in or sliding
        this._filterRevealer.connect('notify::child-revealed', () => this._syncFilterGroup());
        watchKeys(this, this._settings, [FILTER_KEY], () => this._syncFilterBar());
    }

    // Turning the bar off drops its filter too, no row stays hidden without
    // a visible reason
    _syncFilterBar() {
        const isShown = this._settings.get_boolean(FILTER_KEY);
        this._filterRevealer.reveal_child = isShown;
        this._syncFilterGroup();
        if (!isShown) {
            this._search.clear();
            return;
        }
        // A toggle on the visible page means someone is about to type
        if (this.get_mapped())
            this._search.grab_focus();
    }

    _syncFilterGroup() {
        const revealer = this._filterRevealer;
        this._filterGroup.visible = revealer.reveal_child || revealer.child_revealed;
    }

    _refreshFilter() {
        const options = new Map();
        for (const {badges} of this._appRows.values())
            badges.forEach(badge => options.set(badge.text, badge));
        this._search.setOptions([...options.values()]
            .sort((a, b) => a.text.localeCompare(b.text)));
        this._applyFilter();
    }

    _applyFilter() {
        const {tokens, query} = this._search;
        let shownCount = 0;
        for (const {row, badges, searchText} of this._appRows.values()) {
            const hasTokens = tokens.every(token => badges.some(badge => badge.text === token));
            row.visible = hasTokens && searchText.includes(query);
            if (row.visible)
                shownCount++;
        }
        const hasNoMatch = this._appRows.size > 0 && shownCount === 0;
        this._noMatchGroup.visible = hasNoMatch;
        if (this._appsGroup)
            this._appsGroup.visible = !hasNoMatch;
    }

    // Probing before the teardown leaves the current list up on a slow mount
    // instead of an empty page. The generation counter drops an overtaken
    // probe rather than rendering it over a newer list.
    _buildUI() {
        const generation = ++this._buildGeneration;
        const apps = getAppConfigs(this._settings);
        apps.sort((a, b) => displayAppName(a, a.id)
            .localeCompare(displayAppName(b, b.id), undefined, {sensitivity: 'base'}));

        Promise.all([probeIconPaths(apps), readShownIcons()]).then(async ([iconPaths, shown]) => {
            this._shownIcons = shown;
            const tintedIcons = await this._tintIcons(apps, iconPaths);
            if (generation !== this._buildGeneration)
                return;
            this._replaceAppList(apps, iconPaths, tintedIcons);
            this._markGoneApps(apps, generation);
        });
    }

    _tintIcons(apps, iconPaths) {
        const useSymbolic = this._settings.get_boolean('enable-symbolic-icons');
        return tintedSymbolicIconMap(
            apps.map(app => tintSource(this._resolveFor(app, iconPaths), useSymbolic)),
            prefsSymbolicTint(this._settings),
            {size: devicePixelSize(this, ROW_ICON_PX), lookupThemeFile: themeIconFile});
    }

    _resolveFor(app, iconPaths) {
        const themeKey = themeProbeKey(app);
        return resolveAppIcon(app, this._shownIcons[app.id], iconPaths.get(app.cached_icon_path),
            themeKey ? iconPaths.get(themeKey) : null);
    }

    // The new list takes the focus before the old one goes. Removing a focused
    // row first hands the focus to the search text, which opens its suggestions.
    _replaceAppList(apps, iconPaths, tintedIcons) {
        const oldGroup = this._appsGroup;
        const focusIndex = this._focusedRowIndex();
        this._renderApps(apps, iconPaths, tintedIcons);
        this._refreshFilter();
        if (focusIndex >= 0)
            this._focusRowNear(focusIndex);
        if (oldGroup)
            this.remove(oldGroup);
    }

    _focusedRowIndex() {
        const focus = this._window.get_focus();
        const rows = [...this._appRows.values()].map(entry => entry.row);
        return rows.findIndex(row => focus === row || focus?.is_ancestor(row));
    }

    _renderApps(apps, iconPaths, tintedIcons) {
        this._iconPaths = iconPaths;
        this._appRows.clear();

        this._appsGroup = new Adw.PreferencesGroup({
            title: _('Detected Apps'),
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
            const entry = this._createAppEntry(app, iconPaths, tintedIcons, useSymbolic);
            this._appsGroup.add(entry.row);
            this._appRows.set(app.id, entry);
        });

        const hasLegacy = apps.some(a => isLegacyAppId(a.id));
        if (!hasLegacy)
            return;

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

    _createAppEntry(app, iconPaths, tintedIcons, useSymbolic) {
        const iconImage = this._createAppIcon(app, iconPaths, tintedIcons, useSymbolic);
        const hasFlavorGlyph = app.is_proton || app.is_wine;

        const hiddenMark = app.is_hidden
            ? [createIconButton('bti-hidden-symbolic', {tooltip: _('Hidden'), sensitive: false})]
            : [];

        const badges = appBadges(app);
        // Built even without badges, the presence probe can fill it later
        const badgeBox = createBadgeLine(badges);
        this._settings.bind(BADGES_KEY, badgeBox, 'visible', Gio.SettingsBindFlags.GET);
        const title = displayAppName(app, app.id) || _('Unknown App');
        const row = createBadgedActionRow({
            title,
            subtitle: `${_('ID')}: ${app.id}`,
            prefixWidget: iconImage,
            badgeLine: badgeBox,
            suffixWidgets: hiddenMark,
            suffixIcon: NEXT_ICON_NAME,
            onActivate: () => this._openAppConfiguration(app, row),
        });
        return {
            image: hasFlavorGlyph ? null : iconImage,
            badgeBox,
            app,
            row,
            badges,
            // The line break keeps a query from matching across name and ID
            searchText: `${title}\n${app.id}`.toLowerCase(),
        };
    }

    _createAppIcon(app, iconPaths, tintedIcons, useSymbolic) {
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
                tintedIcons.get(tintSource(resolved, useSymbolic)));
        }
        return iconImage;
    }

    // A pointer press leaves the focus where it was, and the dialog hands it
    // back there on close, into the search text with its suggestions
    _openAppConfiguration(appData, row) {
        row.grab_focus();
        const dialog = new AppDialog(this._settings, appData.id, appData, this._iconPaths, {
            isGone: this._goneIds.has(appData.id),
            onForget: () => addToast(this._window, new Adw.Toast({title: _('App forgotten')})),
        });
        dialog.present(this._window);
    }

    _cleanupLegacyIds(apps) {
        this._deleteAppConfigsStaggered(apps.filter(a => isLegacyAppId(a.id)).map(a => a.id));
    }

    _focusRowNear(index) {
        const rows = [...this._appRows.values()].map(entry => entry.row);
        const shown = rows.slice(index).find(row => row.visible) ?? rows.findLast(row => row.visible);
        shown?.grab_focus();
    }

    // Probed after the list is up, a slow disk delays the mark, not the page
    _markGoneApps(apps, generation) {
        this._goneIds = new Set();
        probeGoneApps(apps, this._shownIcons).then(gone => {
            if (generation !== this._buildGeneration)
                return;
            this._goneIds = gone;
            // Any other badge describes how the app was installed, which no
            // longer holds once it is gone
            for (const appId of gone) {
                const entry = this._appRows.get(appId);
                entry.image._btiPendingIcon = GONE_ICON_NAME;
                entry.image.set_from_icon_name(GONE_ICON_NAME);
                entry.badges = [{text: _('Not Installed'), variant: 'info'}];
                setBadges(entry.badgeBox, entry.badges);
            }
            this._refreshFilter();
        });
    }

    // A status flip touches one row, so only that row's image is redrawn.
    _applyShownIcons(shown) {
        const previous = this._shownIcons;
        this._shownIcons = shown;
        for (const [appId, {image, app}] of this._appRows) {
            const hasChanged = JSON.stringify(previous[appId]) !== JSON.stringify(shown[appId]);
            if (image && hasChanged)
                applyIconPreview(image, this._resolveFor(app, this._iconPaths), this._settings);
        }
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
        this._deleteAppConfigsStaggered(ids, () =>
            addToast(this._window, new Adw.Toast({title: _('All apps forgotten')})));
    }

    _deleteAppConfigsStaggered(appIds, onComplete) {
        const [next, ...rest] = appIds;
        if (!next) {
            onComplete?.();
            return;
        }
        deleteAppConfig(this._settings, next);
        clearIds(this, removeTimer, '_forgetTimeoutId');
        this._forgetTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, APP_FORGET_STAGGER_MS, () => {
            this._forgetTimeoutId = 0;
            this._deleteAppConfigsStaggered(rest, onComplete);
            return GLib.SOURCE_REMOVE;
        });
    }

    _confirmResetAll() {
        showConfirmationDialog(this._window, {
            title: _('Reset all apps?'),
            message: _('Restores every setting of every detected app to its default, name, icon, status icons and hiding included. Their order is kept.'),
            confirmLabel: _('Reset All'),
            destructive: true,
            onConfirm: () => this._resetAll(),
        });
    }

    _resetAll() {
        resetAllAppConfigs(this._settings);
        addToast(this._window, new Adw.Toast({title: _('All apps reset')}));
    }
}

function isLegacyAppId(id) {
    return LEGACY_ID_PATTERNS.some(pattern => pattern.test(id));
}

function appBadges(app) {
    let flavor = PACKAGING_LABELS[app.packaging];
    if (app.is_proton)
        flavor = _('Proton');
    else if (app.is_wine)
        flavor = _('Wine');

    const badges = flavor ? [{text: flavor, variant: 'info'}] : [];
    if (app.is_background_proxy)
        badges.push({text: _('Background App'), variant: 'info'});
    if (app.is_foreign)
        badges.push({text: _('Panel Applet'), variant: 'info'});
    return badges;
}
