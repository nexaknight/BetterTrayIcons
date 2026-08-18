import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {saveSettingsToFile, loadSettingsFromFile, deleteBackups, resetKeys} from '../../shared/settingsIO.js';
import {createButton, createIconButton, createFileFilter} from '../widgets/gtkHelpers.js';
import {createSwitchRow, createSpinRow, createSegmentedRow, createActionRow, createComplexSwitchRow, createResetButton} from '../widgets/rows.js';
import {addToast} from '../widgets/sidebar.js';
import {showConfirmationDialog, openFileChooser} from '../dialogs/dialogs.js';
import {openSyncDialog} from '../dialogs/syncDialog.js';
import ConfigDialog from '../dialogs/configDialog.js';

// The header reset covers only this page, unlike the factory reset below
// it. The sync wiring (sync-file-path, enable-auto-sync, max-backups)
// survives, same as on import: resetting it would silently detach a
// running sync.
const GENERAL_RESET_KEYS = Object.freeze([
    'enable-wine-support',
    'keep-popup-after-click',
    'keep-popup-on-failed-click',
    'hide-background-apps',
    'enable-background-proxy',
    'enable-tooltips',
    'tooltip-position',
    'tooltip-delay',
    'tray-position',
    'tray-order',
    'visible-icon-limit',
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
        this._createPlacementGroup();
        this._createAdvancedGroup();
        this._createDangerZoneGroup();
    }

    get headerActions() {
        this._headerActions ??= createResetButton(this._settings, GENERAL_RESET_KEYS,
            {window: this._window, includesSubpages: true});
        return this._headerActions;
    }

    _createBehaviorGroup() {
        const group = new Adw.PreferencesGroup({title: _('Behavior')});
        this.add(group);

        group.add(createSwitchRow(
            _('Wine App Icons'),
            _('Show icons from Wine and Proton apps.'),
            this._settings,
            'enable-wine-support'
        ));

        // The dialog's toggle matters exactly while this switch is off, so
        // the gear must stay reachable either way.
        group.add(createComplexSwitchRow(
            _('Keep Overflow Menu Open'),
            _('Stays open after icon clicks and context menus alike.'),
            this._settings,
            'keep-popup-after-click',
            this._window,
            ConfigDialog,
            {
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
            {gearFollowsSwitch: false}
        ));

        group.add(createComplexSwitchRow(
            _('Hide Background Apps'),
            _("Removes GNOME's own list of windowless apps from Quick Settings."),
            this._settings,
            'hide-background-apps',
            this._window,
            ConfigDialog,
            {
                pageTitle: _('Background Apps'),
                groups: [{
                    configs: [{
                        type: 'switch',
                        title: _('Create Tray Icons for Background Apps'),
                        subtitle: _('Adds a tray icon for windowless background apps that lack one of their own.'),
                        key: 'enable-background-proxy',
                    }],
                }],
            }
        ));

        group.add(createComplexSwitchRow(
            _('Show Tooltips'),
            _('Show the app title on hover.'),
            this._settings,
            'enable-tooltips',
            this._window,
            ConfigDialog,
            {
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
            }
        ));
    }

    _createPlacementGroup() {
        const group = new Adw.PreferencesGroup({title: _('Placement')});
        this.add(group);

        group.add(createSegmentedRow(
            _('Panel Box'),
            _('Which part of the panel holds the icons.'),
            this._settings,
            'tray-position',
            [_('Left'), _('Center'), _('Right')],
            ['left', 'center', 'right']
        ));

        group.add(createSpinRow(
            _('Position in Box'),
            this._settings,
            'tray-order',
            0, 20, 1,
            {subtitle: _('Order within the chosen box.')}
        ));

        group.add(createSpinRow(
            _('Visible Icons'),
            this._settings,
            'visible-icon-limit',
            0, 20, 1,
            {subtitle: _('How many icons stay in the panel. Extra icons move to the overflow menu, and 0 moves them all.')}
        ));
    }

    _createAdvancedGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Advanced'),
        });
        this.add(group);

        const importBtn = createIconButton('bti-import-symbolic', {
            tooltip_text: _('Import'),
            callback: () => this._handleImport(),
        });
        const exportBtn = createIconButton('bti-export-symbolic', {
            tooltip_text: _('Export'),
            callback: () => this._handleExport(),
        });
        group.add(createActionRow(_('Backup and Restore'), _('Save settings as JSON or load them back.'), {
            suffixWidgets: [importBtn, exportBtn],
        }));
        group.add(createActionRow(_('Cloud Sync'), _('Keep settings in sync via a shared file.'), {
            headerSuffix: createIconButton('bti-sync-symbolic', {
                flat: false,
                tooltip_text: _('Configure'),
                callback: () => this._openSyncDialog(),
            }),
        }));
    }

    _createDangerZoneGroup() {
        const group = new Adw.PreferencesGroup({title: _('Danger Zone')});
        this.add(group);

        const resetBtn = createButton({
            label: _('Reset'),
            cssClasses: ['destructive-action'],
            valign: 'center',
        });

        resetBtn.connect('clicked', () => {
            showConfirmationDialog(
                this.get_root(),
                _('Reset all settings?'),
                _('All settings will be restored to defaults and sync backups deleted. This cannot be undone.'),
                () => this._performFactoryReset(),
                _('Reset'),
                true
            );
        });

        group.add(createActionRow(_('Factory Reset'), _('Restore defaults and delete sync backups.'), {
            suffixWidgets: [resetBtn],
        }));
    }

    _handleExport() {
        this._openJsonFileChooser(path => this._handleSave(path), true);
    }

    _handleImport() {
        this._openJsonFileChooser(path => {
            showConfirmationDialog(
                this.get_root(),
                _('Import settings?'),
                _('Local settings will be overwritten.'),
                () => this._handleLoad(path),
                _('Import'),
                true
            );
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
            (callback, saveMode) => this._openJsonFileChooser(callback, saveMode)
        );
    }

    _openJsonFileChooser(callback, saveMode) {
        const filter = createFileFilter(_('JSON Files'), ['*.json']);

        openFileChooser(this.get_root(), {
            title: saveMode ? _('Export') : _('Import'),
            action: saveMode ? 'save' : 'open',
            acceptLabel: saveMode ? _('Save') : _('Open'),
            currentName: saveMode ? 'bettertrayicons-settings.json' : null,
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
