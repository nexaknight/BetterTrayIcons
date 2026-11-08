import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {readFileText, fileExists, isCancelledError} from '../../shared/asyncIo.js';
import {saveSettingsToFile, loadSettingsFromFile, deleteBackup, listBackups, isOwnSyncSource, readOwnVersion} from '../../shared/settingsIO.js';
import {clearIds, connectScoped, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {createIconButton} from '../components/button.js';
import {createImage} from '../components/image.js';
import {createSwitchRow, createSpinRow, createActionRow, createEntryRow, createExpanderSection} from '../components/row.js';
import {ENTRY_DEBOUNCE_MS, buildDialogShell, pinDialogWidth, showConfirmationDialog} from '../components/dialog.js';

const SYNC_DIALOG_WIDTH_PX = 460;

const BACKUP_COUNT_MIN = 1;
const BACKUP_COUNT_MAX = 50;

const TIMESTAMP_FORMAT = '%Y-%m-%d %H:%M';
const TIMESTAMP_FORMAT_WITH_SECONDS = '%Y-%m-%d %H:%M:%S';

const PUSH_ICON_NAME = 'bti-push-symbolic';
const PULL_ICON_NAME = 'bti-pull-symbolic';
const HEADER_BUTTON_SPACING_PX = 4;

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

    const refreshNow = () => refreshAll({immediate: true});
    const file = _buildSyncLocationGroup(page, settings, openJsonFileChooser, cancellable);
    const auto = _buildAutoSyncGroup(page, settings, file.pathRow, cancellable);
    const backups = _buildBackupHistoryGroup(page, file.pathRow, dialog, toast, settings, refreshNow, cancellable);

    const doRefresh = () => {
        file.refreshStatus();
        auto.refreshStatus();
        backups.refreshSyncButtons();
        backups.refresh();
    };

    // Typing in the path row fires per keystroke and each probe below can
    // stat a remote mount, so one shared debounce covers them all.
    const timers = {refresh: 0, initial: 0};
    const refreshAll = ({immediate = false} = {}) => {
        if (immediate) {
            clearIds(timers, removeTimer, 'refresh');
            doRefresh();
            return;
        }
        debounceTo(timers, 'refresh', ENTRY_DEBOUNCE_MS, doRefresh);
    };

    dialog.connect('closed', () => clearIds(timers, removeTimer, 'refresh', 'initial'));

    file.pathRow.connect('notify::text', () => refreshAll());
    connectScoped(dialog, settings, 'changed::enable-auto-sync', refreshNow, 'closed');
    connectScoped(dialog, settings, 'changed::max-backups', () => backups.refresh(), 'closed');

    timers.initial = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        timers.initial = 0;
        refreshNow();
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

    const pathRow = createEntryRow({title: _('File'), showApplyButton: true});

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
        warningIcon.set_visible(false);
        if (!path) {
            statusRow.set_subtitle(_('No file selected'));
            return;
        }

        statusRow.set_subtitle(_('Checking…'));
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
        const ownVersion = await readOwnVersion();
        warningIcon.set_visible(false);
        statusRow.set_subtitle(_formatSyncStatus(mtime, data._meta, ownVersion));
    } catch (e) {
        if (isCancelledError(e))
            return;
        warningIcon.set_visible(true);
        statusRow.set_subtitle(mtime ? mtime.to_local().format(TIMESTAMP_FORMAT_WITH_SECONDS) : _('Unknown'));
    }
}

function _formatSyncStatus(mtime, meta, ownVersion) {
    const timeText = mtime ? mtime.to_local().format(TIMESTAMP_FORMAT) : _('Unknown');
    if (!meta || !meta.source)
        return timeText;
    const origin = isOwnSyncSource(meta) ? _('this device') : meta.source;
    const status = `${timeText} · ${_('from')} ${origin}`;
    if (meta.version === ownVersion)
        return status;
    const writer = meta.version ? _('version %s').format(meta.version) : _('an older version');
    return `${status} · ${writer}`;
}

function _buildAutoSyncGroup(page, settings, pathRow, cancellable) {
    const group = new Adw.PreferencesGroup();
    page.add(group);

    const idleSubtitle = _('Push on change, pull on remote update.');
    const row = createSwitchRow({
        title: _('Sync Settings Automatically'),
        subtitle: idleSubtitle,
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
            row.set_subtitle(idleSubtitle);
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

function _buildBackupHistoryGroup(page, pathRow, dialog, toast, settings, onAfterAction, cancellable) {
    const syncButtons = _buildSyncButtons({pathRow, settings, dialog, toast, onAfterAction, cancellable});
    const group = new Adw.PreferencesGroup({header_suffix: syncButtons.box});
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
            const isSuperseded = generation !== refreshGeneration || cancellable.is_cancelled();
            if (isSuperseded)
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
        });
    };

    return {refresh, refreshSyncButtons: syncButtons.refresh};
}

function _buildSyncButtons({pathRow, settings, dialog, toast, onAfterAction, cancellable}) {
    // Sensitivity trails the path row by the refresh debounce, so a click
    // right after clearing the path still lands here with no file.
    const hasPath = () => pathRow.text !== '';

    const pushButton = createIconButton(PUSH_ICON_NAME, {
        circular: false,
        sensitive: false,
        tooltip: _('Push to File'),
        onClick: () => {
            if (!hasPath())
                return;
            _runSyncOperation(() => saveSettingsToFile(settings, pathRow.text, {merge: true}), toast, onAfterAction, {
                successMessage: written => written ? _('Settings pushed') : _('Nothing new to push'),
                failurePrefix: _('Push failed'),
            });
        },
    });

    const pullButton = createIconButton(PULL_ICON_NAME, {
        circular: false,
        sensitive: false,
        tooltip: _('Pull from File'),
        onClick: () => {
            if (!hasPath())
                return;
            _confirmAndRunSync(dialog, toast, onAfterAction, {
                heading: _('Pull from file?'),
                body: _('App settings are merged; other settings are taken from the file.'),
                confirmLabel: _('Pull'),
                op: () => loadSettingsFromFile(settings, pathRow.text, {merge: true}),
                successMessage: () => _('Settings pulled'), failurePrefix: _('Pull failed'),
            });
        },
    });

    const box = new Gtk.Box({spacing: HEADER_BUTTON_SPACING_PX});
    box.append(pushButton);
    box.append(pullButton);

    const refresh = () => {
        pushButton.sensitive = hasPath();
        pullButton.sensitive = false;
        if (!hasPath())
            return;
        _checkExistsAsync(pathRow.text, cancellable, exists => {
            pullButton.sensitive = exists;
        });
    };

    return {box, refresh};
}

function _buildBackupRow({path, index, mtime, dialog, toast, settings, onAfterAction}) {
    const label = mtime
        ? `${_('Backup')} ${index} · ${mtime.to_local().format(TIMESTAMP_FORMAT)}`
        : `${_('Backup')} ${index}`;

    const deleteButton = createIconButton('bti-trash-symbolic', {
        extraClasses: ['destructive-action'],
        tooltip: _('Delete'),
        onClick: () => _confirmAndRunSync(dialog, toast, onAfterAction, {
            heading: _('Delete this backup?'), body: _('The backup file will be permanently removed.'), confirmLabel: _('Delete'),
            op: () => deleteBackup(path),
            successMessage: () => _('Backup deleted'), failurePrefix: _('Delete failed'),
        }),
    });

    const restoreButton = createIconButton('bti-download-symbolic', {
        flat: false,
        tooltip: _('Restore'),
        onClick: () => _confirmAndRunSync(dialog, toast, onAfterAction, {
            heading: _('Restore this backup?'), body: _('Local settings will be overwritten.'), confirmLabel: _('Restore'),
            op: () => loadSettingsFromFile(settings, path),
            successMessage: () => _('Backup restored'), failurePrefix: _('Restore failed'),
        }),
    });

    return createActionRow({title: label, suffixWidgets: [deleteButton, restoreButton]});
}

async function _checkExistsAsync(path, cancellable, onResult) {
    try {
        onResult(await fileExists(path, cancellable));
    } catch {
        // Only a cancel throws, and the dialog is gone by then.
    }
}

async function _runSyncOperation(op, toast, onAfter, {successMessage, failurePrefix}) {
    try {
        const result = await op();
        toast.add_toast(new Adw.Toast({title: successMessage(result)}));
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
