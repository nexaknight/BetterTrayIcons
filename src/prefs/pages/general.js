import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {saveSettingsToFile, loadSettingsFromFile, deleteBackups} from '../../shared/settingsIO.js';
import {createButton, createIconButton, createFileFilter} from '../widgets/gtkHelpers.js';
import {createSwitchRow, createSpinRow, createComboRow, createActionRow, bindVisibility} from '../widgets/rows.js';
import {showConfirmationDialog, openFileChooser} from '../dialogs/dialogs.js';
import {openSyncDialog} from '../dialogs/syncDialog.js';

export class GeneralPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    _init(settings) {
        super._init({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        this._settings = settings;

        this._createBehaviorGroup();
        this._createLayoutGroup();
        this._createAdvancedGroup();
        this._createDangerZoneGroup();
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

        group.add(createSwitchRow(
            _('Keep Overflow Menu Open'),
            _('Menu items still close immediately on click.'),
            this._settings,
            'keep-popup-after-click'
        ));

        group.add(createSwitchRow(
            _('Show Tooltips'),
            _('Show the app title on hover.'),
            this._settings,
            'enable-tooltips'
        ));

        const positionRow = createComboRow(
            _('Tooltip Position'),
            null,
            this._settings,
            'tooltip-position',
            [_('Top'), _('Bottom')],
            ['top', 'bottom']
        );

        const delayRow = createSpinRow(
            _('Tooltip Delay (ms)'),
            this._settings,
            'tooltip-delay',
            0, 5000, 50
        );
        this._settings.bind('enable-tooltips', positionRow, 'visible', Gio.SettingsBindFlags.GET);
        this._settings.bind('enable-tooltips', delayRow, 'visible', Gio.SettingsBindFlags.GET);
        group.add(positionRow);
        group.add(delayRow);
    }

    _createLayoutGroup() {
        const group = new Adw.PreferencesGroup({title: _('Layout')});
        this.add(group);

        group.add(createComboRow(
            _('Panel Box'),
            _('Where icons appear in the top panel.'),
            this._settings,
            'tray-position',
            [_('Right'), _('Center'), _('Left')],
            ['right', 'center', 'left']
        ));

        group.add(createSpinRow(
            _('Position in Box'),
            this._settings,
            'tray-order',
            0, 20, 1
        ));

        group.add(createSpinRow(
            _('Visible Icons'),
            this._settings,
            'visible-icon-limit',
            0, 20, 1
        ));

        const modeRow = createComboRow(
            _('Overflow Layout'),
            null,
            this._settings,
            'overflow-layout-mode',
            [_('Grid'), _('Row')],
            ['grid', 'row']
        );
        group.add(modeRow);

        const colLimitRow = createSpinRow(
            _('Grid Columns'),
            this._settings,
            'grid-column-limit',
            1, 10, 1
        );
        group.add(colLimitRow);

        bindVisibility(
            this._settings,
            'overflow-layout-mode',
            colLimitRow,
            'grid'
        );
    }

    _createAdvancedGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Advanced'),
        });
        this.add(group);

        const row = new Adw.ActionRow({
            title: _('Backup and Restore'),
            subtitle: _('Save settings as JSON or load them back.'),
        });

        const importBtn = createIconButton('document-open-symbolic', {
            tooltip_text: _('Import'),
            callback: () => this._handleImport(),
        });
        row.add_suffix(importBtn);

        const exportBtn = createIconButton('document-save-symbolic', {
            tooltip_text: _('Export'),
            callback: () => this._handleExport(),
        });
        row.add_suffix(exportBtn);

        group.add(row);
        group.add(createActionRow(_('Cloud Sync'), _('Keep settings in sync via a shared file.'), {
            experimental: false,
            headerSuffix: createIconButton('emblem-synchronizing-symbolic', {
                flat: false,
                tooltip_text: _('Configure'),
                callback: () => this._openSyncDialog(),
            }),
        }));
    }

    _createDangerZoneGroup() {
        const group = new Adw.PreferencesGroup({title: _('Danger Zone')});
        this.add(group);

        const row = new Adw.ActionRow({
            title: _('Factory Reset'),
            subtitle: _('Restore defaults and delete sync backups.'),
        });

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

        row.add_suffix(resetBtn);
        group.add(row);
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
        const filter = createFileFilter('JSON Files', ['*.json']);

        openFileChooser(this.get_root(), {
            title: saveMode ? _('Export') : _('Import'),
            action: saveMode ? 'save' : 'open',
            acceptLabel: saveMode ? _('Save') : _('Open'),
            currentName: saveMode ? 'bettertrayicons-settings.json' : null,
            filters: [filter],
        }, callback);
    }

    _performFactoryReset() {
        // Capture the path before resetting, because reset clears it.
        const syncPath = this._settings.get_string('sync-file-path');

        // A scratch instance in delay mode turns the reset into one dconf
        // transaction. delay() on the shared instance would leave it
        // delayed for good.
        const batch = new Gio.Settings({settings_schema: this._settings.settings_schema});
        batch.delay();
        batch.list_keys().forEach(key => batch.reset(key));
        batch.apply();

        if (syncPath)
            deleteBackups(syncPath);

        const root = this.get_root();
        if (root && root.add_toast)
            root.add_toast(new Adw.Toast({title: _('Settings reset')}));
    }
}
