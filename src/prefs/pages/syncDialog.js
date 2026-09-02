import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {readFileText, fileExists, isCancelledError} from '../../shared/asyncIo.js';
import {saveSettingsToFile, loadSettingsFromFile, deleteBackup, listBackups, isOwnSyncSource} from '../../shared/settingsIO.js';
import {clearIds, connectScoped, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {createButton, createIconButton} from '../components/button.js';
import {createImage} from '../components/image.js';
import {createSwitchRow, createSpinRow, createActionRow, createExpanderSection} from '../components/row.js';
import {ENTRY_DEBOUNCE_MS, buildDialogShell, pinDialogWidth, showConfirmationDialog} from '../components/dialog.js';

const SYNC_DIALOG_WIDTH_PX = 460;

const BACKUP_COUNT_MIN = 1;
const BACKUP_COUNT_MAX = 50;

const TIMESTAMP_FORMAT = '%Y-%m-%d %H:%M';
const TIMESTAMP_FORMAT_WITH_SECONDS = '%Y-%m-%d %H:%M:%S';

export function openSyncDialog(parentWindow, settings, openJsonFileChooser) {
    const {toolbarView, page, toast} = buildDialogShell({toast: true});

    const dialog = new Adw.Dialog({
        title: _('Cloud Sync'),
        follows_content_size: true,
        child: toolbarView,
    });
    pinDialogWidth(dialog, SYNC_DIALOG_WIDTH_PX);

    const cancellable = new Gio.Cancellable();
    dialog.connect('closed', () => cancellable.cancel());

    let refreshAll = () => {};

    const file = _buildSyncLocationGroup(page, settings, openJsonFileChooser, cancellable);
    const auto = _buildAutoSyncGroup(page, settings, file.pathRow, cancellable);
    const actions = _buildActionsGroup(page, file.pathRow, settings, dialog, toast, () => refreshAll({immediate: true}), cancellable);
    const backups = _buildBackupHistoryGroup(page, file.pathRow, dialog, toast, settings, () => refreshAll({immediate: true}), cancellable);

    const doRefresh = () => {
        file.refreshStatus();
        auto.refreshStatus();
        actions.refreshButtons();
        backups.refresh();
    };

    // Typing in the path row fires per keystroke and each probe below can
    // stat a remote mount, so one shared debounce covers them all.
    const timers = {refresh: 0};
    refreshAll = ({immediate = false} = {}) => {
        if (immediate) {
            clearIds(timers, removeTimer, 'refresh');
            doRefresh();
            return;
        }
        debounceTo(timers, 'refresh', ENTRY_DEBOUNCE_MS, doRefresh);
    };

    dialog.connect('closed', () => clearIds(timers, removeTimer, 'refresh'));

    file.pathRow.connect('notify::text', () => refreshAll());
    connectScoped(dialog, settings, 'changed::enable-auto-sync', () => refreshAll({immediate: true}), 'closed');
    connectScoped(dialog, settings, 'changed::max-backups', () => backups.refresh(), 'closed');

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        refreshAll({immediate: true});
        return GLib.SOURCE_REMOVE;
    });

    dialog.present(parentWindow);
}

function _buildSyncLocationGroup(page, settings, openJsonFileChooser, cancellable) {
    const group = new Adw.PreferencesGroup({
        title: _('Sync File'),
        description: _('A shared JSON file on Nextcloud, a NAS, or another cloud folder.'),
    });
    page.add(group);

    const pathRow = new Adw.EntryRow({
        title: _('File'),
        show_apply_button: true,
    });

    settings.bind('sync-file-path', pathRow, 'text', Gio.SettingsBindFlags.DEFAULT);

    const warningIcon = createImage({
        icon_name: 'bti-warning-symbolic',
        valign: 'center',
        visible: false,
        tooltip_text: _('File is not valid JSON'),
    });
    pathRow.add_suffix(warningIcon);

    const fileButton = createIconButton('bti-folder-symbolic', {
        circular: false,
        onClick: () => {
            openJsonFileChooser(path => {
                pathRow.set_text(path);
                settings.set_string('sync-file-path', path);
            }, true);
        },
    });
    pathRow.add_suffix(fileButton);
    group.add(pathRow);

    const statusRow = createActionRow({title: _('Last Sync'), subtitle: _('No file selected')});
    group.add(statusRow);

    const refreshStatus = () => {
        const path = pathRow.text;
        if (!path) {
            statusRow.set_subtitle(_('No file selected'));
            warningIcon.set_visible(false);
            return;
        }

        statusRow.set_subtitle(_('Checking…'));
        warningIcon.set_visible(false);
        _probeSyncFile(path, statusRow, warningIcon, cancellable);
    };

    return {pathRow, refreshStatus};
}

async function _probeSyncFile(path, statusRow, warningIcon, cancellable) {
    const file = Gio.File.new_for_path(path);

    let mtime;
    try {
        const info = await file.query_info_async('time::modified', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
        mtime = info.get_modification_date_time();
    } catch (e) {
        if (isCancelledError(e))
            return;
        statusRow.set_subtitle(_('File not yet created'));
        warningIcon.set_visible(false);
        return;
    }

    try {
        const data = JSON.parse(await readFileText(file, cancellable));
        warningIcon.set_visible(false);
        statusRow.set_subtitle(_formatSyncStatus(mtime, data._meta));
    } catch (e) {
        if (isCancelledError(e))
            return;
        warningIcon.set_visible(true);
        statusRow.set_subtitle(mtime ? mtime.format(TIMESTAMP_FORMAT_WITH_SECONDS) : _('Unknown'));
    }
}

function _formatSyncStatus(mtime, meta) {
    const timeText = mtime ? mtime.format(TIMESTAMP_FORMAT) : _('Unknown');
    if (!meta || !meta.source)
        return timeText;
    const origin = isOwnSyncSource(meta) ? _('this device') : meta.source;
    return `${timeText} · ${_('from')} ${origin}`;
}

function _buildAutoSyncGroup(page, settings, pathRow, cancellable) {
    const group = new Adw.PreferencesGroup({title: _('Auto-Sync')});
    page.add(group);

    const row = createSwitchRow({
        title: _('Enable'),
        subtitle: _('Push on change, pull on remote update.'),
        settings,
        key: 'enable-auto-sync',
    });
    group.add(row);

    group.add(createSpinRow({
        title: _('Maximum Backups'),
        settings,
        key: 'max-backups',
        min: BACKUP_COUNT_MIN,
        max: BACKUP_COUNT_MAX,
    }));

    const refreshStatus = () => {
        if (!settings.get_boolean('enable-auto-sync')) {
            row.set_subtitle(_('Push on change, pull on remote update.'));
            return;
        }
        const path = pathRow.text;
        if (!path) {
            row.set_subtitle(_('Set a file path first.'));
            return;
        }
        _checkExistsAsync(path, cancellable, exists => {
            row.set_subtitle(exists ? _('Watching for changes.') : _('Waiting for the file.'));
        });
    };

    return {refreshStatus};
}

function _buildActionsGroup(page, pathRow, settings, dialog, toast, onAfterAction, cancellable) {
    const group = new Adw.PreferencesGroup({title: _('Manual Sync')});
    page.add(group);

    const pushButton = _buildActionRow(group, {
        title: _('Push to File'),
        buttonLabel: _('Push'),
        onClick: () => {
            const path = pathRow.get_text();
            if (!path)
                return;
            _runSyncOperation(() => saveSettingsToFile(settings, path), toast, onAfterAction, {
                successMessage: _('Settings pushed'), failurePrefix: _('Push failed'),
            });
        },
    });

    const pullButton = _buildActionRow(group, {
        title: _('Pull from File'),
        buttonLabel: _('Pull'),
        onClick: () => {
            const path = pathRow.get_text();
            if (!path)
                return;
            _confirmAndRunSync(dialog, toast, onAfterAction, {
                heading: _('Pull from file?'),
                body: _('App settings are merged; other settings are taken from the file.'),
                confirmLabel: _('Pull'),
                op: () => loadSettingsFromFile(settings, path, {merge: true}),
                successMessage: _('Settings pulled'), failurePrefix: _('Pull failed'),
            });
        },
    });

    const refreshButtons = () => {
        const path = pathRow.text;
        pushButton.sensitive = !!path;
        pullButton.sensitive = false;
        if (!path)
            return;
        _checkExistsAsync(path, cancellable, exists => {
            pullButton.sensitive = exists;
        });
    };

    return {refreshButtons};
}

function _buildActionRow(group, {title, buttonLabel, onClick}) {
    const button = createButton({label: buttonLabel, valign: 'center'});
    button.connect('clicked', onClick);
    group.add(createActionRow({title, suffixWidgets: [button]}));
    return button;
}

async function _checkExistsAsync(path, cancellable, onResult) {
    try {
        onResult(await fileExists(path, cancellable));
    } catch {
        // Cancelled
    }
}

async function _runSyncOperation(op, toast, onAfter, {successMessage, failurePrefix}) {
    try {
        await op();
        toast.add_toast(new Adw.Toast({title: successMessage}));
        onAfter();
    } catch (e) {
        error(`${failurePrefix}: ${e.message}`);
        toast.add_toast(new Adw.Toast({title: `${failurePrefix}: ${e.message}`}));
    }
}

function _confirmAndRunSync(dialog, toast, onAfterAction, {heading, body, confirmLabel, op, successMessage, failurePrefix}) {
    showConfirmationDialog(dialog, {
        title: heading,
        message: body,
        confirmLabel,
        destructive: true,
        onConfirm: () => _runSyncOperation(op, toast, onAfterAction, {successMessage, failurePrefix}),
    });
}

function _buildBackupHistoryGroup(page, pathRow, dialog, toast, settings, onAfterAction, cancellable) {
    const group = new Adw.PreferencesGroup();
    page.add(group);

    const {expander, setRows} = createExpanderSection({
        title: _('Backups'),
        subtitle: _('None available'),
    });
    expander.sensitive = false;
    group.add(expander);

    let refreshGeneration = 0;

    const showEmpty = () => {
        expander.sensitive = false;
        expander.subtitle = _('None available');
        expander.expanded = false;
    };

    const refresh = () => {
        const base = pathRow.text;
        const generation = ++refreshGeneration;

        if (!base) {
            setRows([]);
            showEmpty();
            return;
        }

        listBackups(base).then(backups => {
            // A newer refresh or a closed dialog superseded this one.
            if (generation !== refreshGeneration || cancellable.is_cancelled())
                return;

            setRows(backups.map(b => _buildBackupRow({
                path: b.path, index: b.index, mtime: b.mtime,
                dialog, toast, settings, onAfterAction,
            })));

            if (backups.length === 0) {
                showEmpty();
                return;
            }

            expander.sensitive = true;
            expander.subtitle = `${backups.length} ${_('available')}`;
        }).catch(() => { /* Listing failed, keep current rows */ });
    };

    return {refresh};
}

function _buildBackupRow({path, index, mtime, dialog, toast, settings, onAfterAction}) {
    const label = mtime
        ? `${_('Backup')} ${index} · ${mtime.format(TIMESTAMP_FORMAT)}`
        : `${_('Backup')} ${index}`;

    const deleteButton = createIconButton('bti-trash-symbolic', {
        extraClasses: ['destructive-action'],
        tooltip: _('Delete'),
        onClick: () => _confirmAndRunSync(dialog, toast, onAfterAction, {
            heading: _('Delete this backup?'), body: _('The backup file will be permanently removed.'), confirmLabel: _('Delete'),
            op: () => deleteBackup(path),
            successMessage: _('Backup deleted'), failurePrefix: _('Delete failed'),
        }),
    });

    const restoreButton = createIconButton('bti-download-symbolic', {
        flat: false,
        tooltip: _('Restore'),
        onClick: () => _confirmAndRunSync(dialog, toast, onAfterAction, {
            heading: _('Restore this backup?'), body: _('Local settings will be overwritten.'), confirmLabel: _('Restore'),
            op: () => loadSettingsFromFile(settings, path),
            successMessage: _('Backup restored'), failurePrefix: _('Restore failed'),
        }),
    });

    return createActionRow({title: label, suffixWidgets: [deleteButton, restoreButton]});
}
