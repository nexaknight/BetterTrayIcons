import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {saveSettingsToFile, loadSettingsFromFile, deleteBackups, resetKeys} from '../../shared/settingsIO.js';
import {createButton, createIconButton} from '../components/button.js';
import {createFileFilter, showConfirmationDialog, openFileChooser} from '../components/dialog.js';
import {createSwitchRow, createActionRow, createComplexSwitchRow} from '../components/row.js';
import {createResetButton} from '../components/page.js';
import {addToast} from '../components/sidebar.js';
import {openSyncDialog} from './syncDialog.js';
import ConfigDialog from '../dialogs/configDialog.js';

// The header reset covers only this page, unlike the factory reset below
// it. The sync wiring (sync-file-path, enable-auto-sync) survives, same as
// on import, since resetting it would silently detach a running sync.
const GENERAL_RESET_KEYS = Object.freeze([
    'enable-wine-support',
    'keep-popup-after-click',
    'keep-popup-on-failed-click',
    'hide-background-apps',
    'enable-background-proxy',
    'enable-tooltips',
    'tooltip-position',
    'tooltip-delay',
]);

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

    _createBehaviorGroup() {
        const group = new Adw.PreferencesGroup({title: _('Behavior')});
        this.add(group);

        group.add(createSwitchRow({
            title: _('Wine App Icons'),
            subtitle: _('Show icons from Wine and Proton apps.'),
            settings: this._settings,
            key: 'enable-wine-support',
        }));

        // The dialog's toggle matters exactly while this switch is off, so
        // the gear must stay reachable either way.
        group.add(createComplexSwitchRow({
            title: _('Keep Overflow Menu Open'),
            subtitle: _('Stays open after icon clicks and context menus alike.'),
            settings: this._settings,
            key: 'keep-popup-after-click',
            window: this._window,
            DialogClass: ConfigDialog,
            dialogData: {
                pageTitle: _('Overflow Menu'),
                groups: [{
                    configs: [{
                        type: 'switch',
                        title: _('Stay Open When a Click Has No Effect'),
                        subtitle: _('Some apps never answer a click.'),
                        key: 'keep-popup-on-failed-click',
                    }],
                }],
            },
            gearFollowsSwitch: false,
        }));

        group.add(createComplexSwitchRow({
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
        }));

        group.add(createComplexSwitchRow({
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
                            min: 0, max: 5000, step: 50,
                        },
                    ],
                }],
            },
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
            headerSuffix: createIconButton('bti-sync-symbolic', {
                flat: false,
                tooltip: _('Configure'),
                onClick: () => this._openSyncDialog(),
            }),
        }));
    }

    _createDangerZoneGroup() {
        const group = new Adw.PreferencesGroup({title: _('Danger Zone')});
        this.add(group);

        const resetButton = createButton({
            label: _('Reset'),
            cssClasses: ['destructive-action'],
            valign: 'center',
        });

        resetButton.connect('clicked', () => {
            showConfirmationDialog(this.get_root(), {
                title: _('Reset all settings?'),
                message: _('All settings will be restored to defaults and sync backups deleted. This cannot be undone.'),
                confirmLabel: _('Reset'),
                destructive: true,
                onConfirm: () => this._performFactoryReset(),
            });
        });

        group.add(createActionRow({
            title: _('Factory Reset'),
            subtitle: _('Restore defaults and delete sync backups.'),
            suffixWidgets: [resetButton],
        }));
    }

    _handleExport() {
        this._openJsonFileChooser(path => this._handleSave(path), true);
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

    async _handleSave(path) {
        try {
            await saveSettingsToFile(this._settings, path);
        } catch (e) {
            error(`Export failed: ${e.message}`);
        }
    }

    async _handleLoad(path) {
        try {
            await loadSettingsFromFile(this._settings, path);
        } catch (e) {
            error(`Import failed: ${e.message}`);
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
            currentName: isSaveMode ? 'bettertrayicons-settings.json' : null,
            filters: [filter],
        }, callback);
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
