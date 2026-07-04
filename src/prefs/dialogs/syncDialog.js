import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {readFileBytes} from '../../shared/fetch.js';
import {saveSettingsToFile, loadSettingsFromFile, deleteBackup, listBackups} from '../../shared/settingsIO.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {createButton, createIconButton, createImage} from '../widgets/gtkHelpers.js';
import {createSwitchRow, createSpinRow} from '../widgets/rows.js';
import {showConfirmationDialog} from './dialogs.js';
import {ENTRY_DEBOUNCE_MS} from '../../const.js';

export function openSyncDialog(parentWindow, settings, openJsonFileChooser) {
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(new Adw.HeaderBar());

    const toast = new Adw.ToastOverlay();
    const page = new Adw.PreferencesPage();
    toast.set_child(page);
    toolbarView.set_content(toast);

    const dialog = new Adw.Dialog({
        title: _('Cloud Sync'),
        content_width: 460,
        child: toolbarView,
    });

    // Cancelled on close so the probe can't touch destroyed widgets.
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
    // stat a remote mount. One shared debounce covers them all; `immediate`
    // skips it after Push/Pull/Delete so the rows update right away.
    let refreshDebounceId = 0;
    refreshAll = ({immediate = false} = {}) => {
        if (refreshDebounceId) {
            GLib.source_remove(refreshDebounceId);
            refreshDebounceId = 0;
        }
        if (immediate) {
            doRefresh();
            return;
        }
        refreshDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ENTRY_DEBOUNCE_MS, () => {
            refreshDebounceId = 0;
            doRefresh();
            return GLib.SOURCE_REMOVE;
        });
    };

    dialog.connect('closed', () => {
        if (refreshDebounceId) {
            GLib.source_remove(refreshDebounceId);
            refreshDebounceId = 0;
        }
    });

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

    if (settings.settings_schema.has_key('sync-file-path'))
        settings.bind('sync-file-path', pathRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    else
        pathRow.set_subtitle(_('Schema key "sync-file-path" missing.'));


    const warningIcon = createImage({
        icon_name: 'dialog-warning-symbolic',
        valign: 'center',
        visible: false,
        tooltip_text: _('File is not valid JSON'),
    });
    pathRow.add_suffix(warningIcon);

    const fileBtn = createIconButton('folder-open-symbolic', {
        circular: false,
        callback: () => {
            openJsonFileChooser(path => {
                pathRow.set_text(path);
                if (settings.settings_schema.has_key('sync-file-path'))
                    settings.set_string('sync-file-path', path);
            }, true);
        },
    });
    pathRow.add_suffix(fileBtn);
    group.add(pathRow);

    const statusRow = new Adw.ActionRow({
        title: _('Last Sync'),
        subtitle: _('No file selected'),
    });
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

function _probeSyncFile(path, statusRow, warningIcon, cancellable) {
    const file = Gio.File.new_for_path(path);

    file.query_info_async('time::modified', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (src, res) => {
        let mtime;
        try {
            mtime = src.query_info_finish(res).get_modification_date_time();
        } catch (e) {
            if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            statusRow.set_subtitle(_('File not yet created'));
            warningIcon.set_visible(false);
            return;
        }

        readFileBytes(file, cancellable).then(contents => {
            const data = JSON.parse(new TextDecoder().decode(contents));
            warningIcon.set_visible(false);
            statusRow.set_subtitle(_formatSyncStatus(mtime, data._meta));
        }).catch(e => {
            if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            warningIcon.set_visible(true);
            statusRow.set_subtitle(mtime ? mtime.format('%Y-%m-%d %H:%M:%S') : _('Unknown'));
        });
    });
}

function _formatSyncStatus(mtime, meta) {
    const timeStr = mtime ? mtime.format('%Y-%m-%d %H:%M') : _('Unknown');
    if (!meta || !meta.source)
        return timeStr;
    const origin = meta.source === GLib.get_host_name() ? _('this device') : meta.source;
    return `${timeStr} · ${_('from')} ${origin}`;
}

function _buildAutoSyncGroup(page, settings, pathRow, cancellable) {
    const group = new Adw.PreferencesGroup({title: _('Auto-Sync')});
    page.add(group);

    const row = createSwitchRow(
        _('Enable'),
        _('Push on change, pull on remote update.'),
        settings,
        'enable-auto-sync'
    );
    group.add(row);

    group.add(createSpinRow(
        _('Maximum Backups'),
        settings,
        'max-backups',
        1, 50, 1
    ));

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

    const pushBtn = _buildActionRow(group, {
        title: _('Push to File'),
        btnLabel: _('Push'),
        onClick: () => {
            const path = pathRow.get_text();
            if (!path)
                return;
            _runSyncOp(() => saveSettingsToFile(settings, path), toast, onAfterAction, {
                successMsg: _('Settings pushed'), failurePrefix: _('Push failed'),
            });
        },
    });

    const pullBtn = _buildActionRow(group, {
        title: _('Pull from File'),
        btnLabel: _('Pull'),
        onClick: () => {
            const path = pathRow.get_text();
            if (!path)
                return;
            showConfirmationDialog(
                dialog, _('Pull from file?'), _('Local settings will be overwritten.'),
                () => _runSyncOp(() => loadSettingsFromFile(settings, path), toast, onAfterAction, {
                    successMsg: _('Settings pulled'), failurePrefix: _('Pull failed'),
                }),
                _('Pull'), true
            );
        },
    });

    const refreshButtons = () => {
        const path = pathRow.text;
        pushBtn.sensitive = !!path;
        pullBtn.sensitive = false;
        if (!path)
            return;
        _checkExistsAsync(path, cancellable, exists => {
            pullBtn.sensitive = exists;
        });
    };

    return {refreshButtons};
}

function _buildActionRow(group, {title, btnLabel, onClick}) {
    const row = new Adw.ActionRow({title});
    const btn = createButton({label: btnLabel, valign: 'center'});
    btn.connect('clicked', onClick);
    row.add_suffix(btn);
    group.add(row);
    return btn;
}

// The path can sit on a network mount, so never stat it synchronously.
function _checkExistsAsync(path, cancellable, onResult) {
    Gio.File.new_for_path(path).query_info_async(
        'standard::type',
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (obj, res) => {
            let exists = false;
            try {
                obj.query_info_finish(res);
                exists = true;
            } catch (e) {
                if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
            }
            onResult(exists);
        }
    );
}

async function _runSyncOp(op, toast, onAfter, {successMsg, failurePrefix}) {
    try {
        await op();
        toast.add_toast(new Adw.Toast({title: successMsg}));
        onAfter();
    } catch (e) {
        error(`${failurePrefix}: ${e.message}`);
        toast.add_toast(new Adw.Toast({title: `${failurePrefix}: ${e.message}`}));
    }
}

function _buildBackupHistoryGroup(page, pathRow, dialog, toast, settings, onAfterAction, cancellable) {
    const group = new Adw.PreferencesGroup();
    page.add(group);

    const expander = new Adw.ExpanderRow({
        title: _('Backups'),
        subtitle: _('None available'),
        sensitive: false,
    });
    group.add(expander);

    let childRows = [];
    let refreshGen = 0;

    const clearRows = () => {
        for (const r of childRows)
            expander.remove(r);
        childRows = [];
    };

    const showEmpty = () => {
        expander.sensitive = false;
        expander.subtitle = _('None available');
        expander.expanded = false;
    };

    const refresh = () => {
        const base = pathRow.text;
        const gen = ++refreshGen;

        if (!base) {
            clearRows();
            showEmpty();
            return;
        }

        listBackups(base).then(backups => {
            // A newer refresh or a closed dialog superseded this one.
            if (gen !== refreshGen || cancellable.is_cancelled())
                return;

            clearRows();
            const compressed = backups.filter(b => b.compressed);
            for (const b of compressed) {
                const childRow = _buildBackupRow({
                    path: b.path, index: b.index, mtime: b.mtime,
                    pathRow, dialog, toast, settings, onAfterAction,
                });
                expander.add_row(childRow);
                childRows.push(childRow);
            }

            if (compressed.length > 0) {
                expander.sensitive = true;
                expander.subtitle = `${compressed.length} ${_('available')}`;
            } else {
                showEmpty();
            }
        }).catch(() => { /* listing failed, keep current rows */ });
    };

    return {refresh};
}

function _buildBackupRow({path, index, mtime, pathRow, dialog, toast, settings, onAfterAction}) {
    const label = mtime
        ? `${_('Backup')} ${index} — ${mtime.format('%Y-%m-%d %H:%M')}`
        : `${_('Backup')} ${index}`;
    const row = new Adw.ActionRow({title: label});

    const deleteBtn = createIconButton('user-trash-symbolic', {
        extraClasses: ['destructive-action'],
        tooltip_text: _('Delete'),
        callback: () => {
            showConfirmationDialog(
                dialog, _('Delete this backup?'), _('The backup file will be permanently removed.'),
                () => _runSyncOp(() => deleteBackup(pathRow.text, index), toast, onAfterAction, {
                    successMsg: _('Backup deleted'), failurePrefix: _('Delete failed'),
                }),
                _('Delete'), true
            );
        },
    });

    const restoreBtn = createIconButton('folder-download-symbolic', {
        flat: false,
        tooltip_text: _('Restore'),
        callback: () => {
            showConfirmationDialog(
                dialog, _('Restore this backup?'), _('Local settings will be overwritten.'),
                () => _runSyncOp(() => loadSettingsFromFile(settings, path), toast, onAfterAction, {
                    successMsg: _('Backup restored'), failurePrefix: _('Restore failed'),
                }),
                _('Restore'), true
            );
        },
    });

    row.add_suffix(deleteBtn);
    row.add_suffix(restoreBtn);

    return row;
}
