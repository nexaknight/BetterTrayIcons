import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {watchKeys} from '../../shared/lifecycle.js';
import {saveSettingsToFile, loadSettingsFromFile, deleteBackups, resetKeys} from '../../shared/settingsIO.js';
import {WHEN_IN_FRONT_NONE, watchSecondaryPanels} from '../../shared/appConfig.js';
import {createButton, createIconButton} from '../components/button.js';
import {createCardPicker} from '../components/card.js';
import {buildPanelBoxScene} from '../components/scenes/panelScene.js';
import {buildQuickSettingsScene} from '../components/scenes/quickSettingsScene.js';
import {createFileFilter, showConfirmationDialog, openFileChooser} from '../components/dialog.js';
import {PANEL_DISPLAY_MODES, bindVisibility, createSwitchRow, createActionRow, createComplexSwitchRow, createBoundToggleGroup, createWrapControlsRow} from '../components/row.js';
import {createResetButton} from '../components/page.js';
import {clearChildren} from '../components/text.js';
import {addToast} from '../components/sidebar.js';
import {openSyncDialog} from './syncDialog.js';
import ConfigDialog from '../dialogs/configDialog.js';

// The header reset covers only this page, unlike the factory reset below
// it. The sync wiring (sync-file-path, enable-auto-sync) survives, same as
// on import, since resetting it would silently detach a running sync.
const GENERAL_RESET_KEYS = Object.freeze([
    'display-mode',
    'show-on-all-monitors',
    'enable-wine-support',
    'keep-popup-after-click',
    'keep-popup-on-failed-click',
    'drawer-remember-state',
    'hide-background-apps',
    'enable-background-proxy',
    'enable-tooltips',
    'tooltip-position',
    'tooltip-delay',
    'when-in-front',
]);

const TOOLTIP_DELAY_MAX_MS = 5000;
const TOOLTIP_DELAY_STEP_MS = 50;
const EXPORT_FILE_NAME = 'bettertrayicons-settings.json';

export class GeneralPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsGeneralPage'}, this);
    }

    _init(window, settings) {
        super._init({
            title: _('General'),
            icon_name: 'bti-general-symbolic',
        });

        this._window = window;
        this._settings = settings;
        this._headerActions = null;

        this._createModeGroup();
        this._createBehaviorGroup();
        this._createAdvancedGroup();
        this._createDangerZoneGroup();
    }

    get headerActions() {
        this._headerActions ??= createResetButton({
            settings: this._settings,
            keys: GENERAL_RESET_KEYS,
            window: this._window,
            includesSubpages: true,
        });
        return this._headerActions;
    }

    _createModeGroup() {
        this.add(createCardPicker({
            title: _('Mode'),
            settings: this._settings,
            key: 'display-mode',
            options: [
                {value: 'popup', label: _('Popup'), preview: this._createPanelScene('popup')},
                {value: 'drawer', label: _('Drawer'), preview: this._createPanelScene('drawer')},
                {value: 'background-apps', label: _('In Background Apps'), preview: buildQuickSettingsScene()},
            ],
            bleed: true,
        }));

        const allMonitorsRow = createSwitchRow({
            title: _('Show on All Monitors'),
            settings: this._settings,
            key: 'show-on-all-monitors',
            help: _('Shows the tray on the panels Dash to Panel draws on your other monitors. One shared icon order on every panel. In Background Apps mode the list follows the Quick Settings you open.'),
        });
        // Rows stack above whatever else a group holds, so the switch takes a
        // group of its own to sit under the cards. Only the shell knows
        // whether another monitor carries a panel to mirror onto.
        const allMonitorsGroup = new Adw.PreferencesGroup({visible: false});
        allMonitorsGroup.add(allMonitorsRow);
        this.add(allMonitorsGroup);
        watchSecondaryPanels(allMonitorsGroup, hasSecondary => (allMonitorsGroup.visible = hasSecondary));
    }

    // The panel cards mirror the placement picked under Appearance
    _createPanelScene(mode) {
        const holder = new Gtk.Box({hexpand: true, vexpand: true});
        const rebuild = () => {
            clearChildren(holder);
            holder.append(buildPanelBoxScene(this._settings, this._settings.get_string('tray-position'), mode));
        };
        watchKeys(holder, this._settings, ['tray-position'], rebuild);
        return holder;
    }

    _createBehaviorGroup() {
        const group = new Adw.PreferencesGroup({title: _('Behavior')});
        this.add(group);

        group.add(createSwitchRow({
            title: _('Wine App Icons'),
            subtitle: _('Show icons from Wine, Proton and other legacy X11 tray apps.'),
            settings: this._settings,
            key: 'enable-wine-support',
        }));

        // The dialog's toggle matters exactly while this switch is off, so
        // the gear must stay reachable either way.
        const failedClickGroups = [{
            configs: [{
                type: 'switch',
                title: _('Stay Open When a Click Has No Effect'),
                subtitle: _('Some apps never answer a click.'),
                key: 'keep-popup-on-failed-click',
            }],
        }];
        // One key keeps the overflow popup or Quick Settings open, the row
        // names whichever the mode shows
        const keepOpenData = {pageTitle: _('Overflow Menu'), groups: failedClickGroups};
        const keepOpenRow = createComplexSwitchRow({
            title: _('Keep Overflow Menu Open'),
            subtitle: _('Stays open after icon clicks and context menus alike.'),
            settings: this._settings,
            key: 'keep-popup-after-click',
            window: this._window,
            DialogClass: ConfigDialog,
            dialogData: keepOpenData,
            gearFollowsSwitch: false,
        });
        const syncKeepOpenRow = () => {
            const isInQuickSettings = this._settings.get_string('display-mode') === 'background-apps';
            keepOpenRow.title = isInQuickSettings ? _('Keep Quick Settings Open') : _('Keep Overflow Menu Open');
            keepOpenData.pageTitle = isInQuickSettings ? _('Quick Settings') : _('Overflow Menu');
        };
        watchKeys(keepOpenRow, this._settings, ['display-mode'], syncKeepOpenRow);
        group.add(keepOpenRow);
        bindVisibility(this._settings, 'display-mode', keepOpenRow, ['popup', 'background-apps']);

        const rememberDrawerRow = createComplexSwitchRow({
            title: _('Remember Drawer State'),
            subtitle: _('Stays open until the toggle button closes it.'),
            settings: this._settings,
            key: 'drawer-remember-state',
            window: this._window,
            DialogClass: ConfigDialog,
            dialogData: {pageTitle: _('Drawer'), groups: failedClickGroups},
            gearFollowsSwitch: false,
        });
        group.add(rememberDrawerRow);
        bindVisibility(this._settings, 'display-mode', rememberDrawerRow, 'drawer');

        const hideBackgroundRow = createComplexSwitchRow({
            title: _('Hide Background Apps'),
            subtitle: _("Removes GNOME's own list of windowless apps from Quick Settings."),
            settings: this._settings,
            key: 'hide-background-apps',
            window: this._window,
            DialogClass: ConfigDialog,
            dialogData: {
                pageTitle: _('Background Apps'),
                groups: [{
                    configs: [{
                        type: 'switch',
                        title: _('Create Tray Icons for Background Apps'),
                        subtitle: _('Adds a tray icon for windowless background apps that lack one of their own.'),
                        key: 'enable-background-proxy',
                    }],
                }],
            },
        });
        group.add(hideBackgroundRow);
        // The tray lives in that list in background-apps mode, so the key has
        // no effect there
        bindVisibility(this._settings, 'display-mode', hideBackgroundRow, PANEL_DISPLAY_MODES);

        const tooltipsRow = createComplexSwitchRow({
            title: _('Show Tooltips'),
            subtitle: _('Show the app title on hover.'),
            settings: this._settings,
            key: 'enable-tooltips',
            window: this._window,
            DialogClass: ConfigDialog,
            dialogData: {
                pageTitle: _('Tooltips'),
                groups: [{
                    configs: [
                        {
                            type: 'segmented',
                            title: _('Position'),
                            key: 'tooltip-position',
                            options: [_('Top'), _('Bottom')],
                            values: ['top', 'bottom'],
                        },
                        {
                            type: 'spin',
                            title: _('Delay (ms)'),
                            key: 'tooltip-delay',
                            min: 0, max: TOOLTIP_DELAY_MAX_MS, step: TOOLTIP_DELAY_STEP_MS,
                        },
                    ],
                }],
            },
        });
        bindVisibility(this._settings, 'display-mode', tooltipsRow, PANEL_DISPLAY_MODES);
        group.add(tooltipsRow);

        const whenInFrontTitle = _('Minimize Action for Unsupported Apps');
        group.add(createWrapControlsRow({
            title: whenInFrontTitle,
            subtitle: _('For apps that do not hide themselves when their icon is clicked while they are in front.'),
            controls: [createBoundToggleGroup({
                title: whenInFrontTitle,
                settings: this._settings,
                key: 'when-in-front',
                options: [_('Per App'), _('Minimize'), _('Close')],
                values: [WHEN_IN_FRONT_NONE, 'minimize', 'close'],
            })],
            badge: {text: _('Experimental')},
            keepTextWhole: true,
            help: _('Many apps hide themselves to the tray when their icon is clicked a second time while they are in front. Some apps do not support that. This setting gives them a similar behavior.\n\n• Per App: set it for each app under Applications. Apps that already hide to the tray keep their own behavior.\n• Minimize: applies to every app. A second click minimizes the app, and it stays visible in the dock.\n• Close: closes the app’s window in front. Some apps quit entirely instead of staying in the tray, and unsaved work can be lost.'),
        }));
    }

    _createAdvancedGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Advanced'),
        });
        this.add(group);

        const importButton = createIconButton('bti-import-symbolic', {
            tooltip: _('Import'),
            onClick: () => this._handleImport(),
        });
        const exportButton = createIconButton('bti-export-symbolic', {
            tooltip: _('Export'),
            onClick: () => this._handleExport(),
        });
        group.add(createActionRow({
            title: _('Backup and Restore'),
            subtitle: _('Save settings as JSON or load them back.'),
            suffixWidgets: [importButton, exportButton],
        }));
        group.add(createActionRow({
            title: _('Cloud Sync'),
            subtitle: _('Keep settings in sync via a shared file.'),
            suffixIcon: 'bti-sync-symbolic',
            onActivate: () => this._openSyncDialog(),
        }));
    }

    _handleImport() {
        this._openJsonFileChooser(path => {
            showConfirmationDialog(this.get_root(), {
                title: _('Import settings?'),
                message: _('Local settings will be overwritten.'),
                confirmLabel: _('Import'),
                destructive: true,
                onConfirm: () => this._handleLoad(path),
            });
        }, false);
    }

    async _handleLoad(path) {
        try {
            await loadSettingsFromFile(this._settings, path);
        } catch (e) {
            error(`Import failed: ${e.message}`);
        }
    }

    _handleExport() {
        this._openJsonFileChooser(path => this._handleSave(path), true);
    }

    async _handleSave(path) {
        try {
            await saveSettingsToFile(this._settings, path);
        } catch (e) {
            error(`Export failed: ${e.message}`);
        }
    }

    _openSyncDialog() {
        openSyncDialog(
            this.get_root(),
            this._settings,
            (callback, isSaveMode) => this._openJsonFileChooser(callback, isSaveMode)
        );
    }

    _openJsonFileChooser(callback, isSaveMode) {
        const filter = createFileFilter(_('JSON Files'), ['*.json']);

        openFileChooser(this.get_root(), {
            title: isSaveMode ? _('Export') : _('Import'),
            action: isSaveMode ? 'save' : 'open',
            acceptLabel: isSaveMode ? _('Save') : _('Open'),
            currentName: isSaveMode ? EXPORT_FILE_NAME : null,
            filters: [filter],
        }, callback);
    }

    _createDangerZoneGroup() {
        const group = new Adw.PreferencesGroup({title: _('Danger Zone')});
        this.add(group);

        const resetButton = createButton({
            label: _('Reset'),
            cssClasses: ['destructive-action'],
            valign: 'center',
            onClick: () => showConfirmationDialog(this.get_root(), {
                title: _('Reset all settings?'),
                message: _('All settings will be restored to defaults and sync backups deleted. This cannot be undone.'),
                confirmLabel: _('Reset'),
                destructive: true,
                onConfirm: () => this._performFactoryReset(),
            }),
        });

        group.add(createActionRow({
            title: _('Factory Reset'),
            subtitle: _('Restore defaults and delete sync backups.'),
            suffixWidgets: [resetButton],
        }));
    }

    _performFactoryReset() {
        // Capture the path before the reset clears it.
        const syncPath = this._settings.get_string('sync-file-path');

        resetKeys(this._settings, this._settings.list_keys());

        if (syncPath)
            deleteBackups(syncPath);

        addToast(this.get_root(), new Adw.Toast({title: _('Settings reset')}));
    }
}
