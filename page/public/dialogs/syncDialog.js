import {expandExpander, expanderRow} from '../components/expander.js';
import {openAlert} from '../components/alert.js';
import {group, groupHeading, groupSection} from '../components/group.js';
import {iconButton} from '../components/icon.js';
import {entryRow, row, spin, switchRow} from '../components/row.js';
import {toast} from '../components/toast.js';
import {overlay} from '../components/window.js';
import {_} from '../shared/i18n.js';
import {state} from '../shared/store.js';
import {views} from '../shared/views.js';

const HOUR_MS = 3600000;
const SAMPLE_BACKUP_COUNT = 3;
const BACKUPS_MIN = 1;
const BACKUPS_MAX = 50;
const EXAMPLE_SYNC_PATH = '/home/nexaknight/nextcloud/bti-sync/bettertrayicons-settings.json';

export function syncContent() {
    const fileRow = entryRow({
        id: 'native-sync-path',
        label: _('File'),
        value: state.syncPath,
        attributes: 'placeholder=""',
        ariaLabel: _('Sync file path'),
        suffix: iconButton('folder', _('Choose a sync file'), 'data-sync-example', 'square'),
        className: 'pref-entry-focused pref-modal-path',
    });
    const groups = group(_('Sync File'), fileRow + row(_('Last Sync'), lastSyncText()), _('A shared JSON file on Nextcloud, a NAS, or another cloud folder.')) +
        group('', switchRow(_('Sync Settings Automatically'), 'autoSync', autoSyncText()) + spin(_('Maximum Backups'), 'backups', BACKUPS_MIN, BACKUPS_MAX)) +
        groupSection('', groupHeading('', syncButtons()) + backupHistory());
    return `<div class="pref-sync-dialog">${groups}</div>`;
}

function lastSyncText() {
    if (!state.syncPath || !state.sampleSyncTime)
        return unsyncedText(state.syncPath);
    return `${state.sampleSyncTime} · ${_('from')} ${_('this device')}`;
}

function unsyncedText(path) {
    return path ? _('File not yet created') : _('No file selected');
}

function autoSyncText() {
    if (!state.autoSync)
        return _('Push on change, pull on remote update.');
    return state.syncPath ? _('Watching for changes.') : _('Set a file path first.');
}

function syncButtons() {
    const pushDisabled = canPush(state.syncPath) ? '' : 'disabled';
    const pullDisabled = canPull(state.syncPath) ? '' : 'disabled';
    return iconButton('push', _('Push to File'), `data-sync-push ${pushDisabled}`, 'square') + iconButton('pull', _('Pull from File'), `data-sync-pull ${pullDisabled}`, 'square');
}

function backupHistory() {
    const backups = state.sampleBackups || [];
    if (!backups.length)
        return expanderRow('backups', _('Backups'), _('None available'), {className: 'pref-backup-expander', hasSuffix: false, isSensitive: false});
    const rows = backups.map(backup =>
        row(`${_('Backup')} ${backup.index} · ${backup.time}`, '', iconButton('trash', _('Delete'), `data-sync-backup-delete="${backup.index}"`, 'destructive') + iconButton('download', _('Restore'), `data-sync-backup-restore="${backup.index}"`))
    ).join('');
    return expanderRow('backups', _('Backups'), `${backups.length} ${_('available')}`, {rows, className: 'pref-backup-expander', hasSuffix: false});
}

function canPush(path) {
    return path !== '';
}

// A pull needs the file, which the demo has once the example file was
// chosen or a push went through
function canPull(path) {
    return path !== '' && Boolean(state.sampleSyncTime);
}

export function setSyncPath(path) {
    state.syncPath = path;
    overlay.querySelector('[data-sync-push]').disabled = !canPush(path);
    overlay.querySelector('[data-sync-pull]').disabled = !canPull(path);
    overlay.querySelector('.pref-entry-focused+.pref-row .pref-row-subtitle').textContent = unsyncedText(path);
}

// The example file stands for a file other devices wrote already
export function useExampleSyncFile() {
    state.syncPath = EXAMPLE_SYNC_PATH;
    state.syncPending = false;
    revealSampleBackups();
    views.renderModal();
}

export function pushToFile() {
    if (!hasUnsyncedChanges()) {
        toast(_('Nothing new to push'));
        return;
    }
    recordPush();
    views.renderModal();
    toast(_('Settings pushed'));
}

export function pullFromFile() {
    state.syncPending = false;
    toast(_('Settings pulled'));
}

// Auto-sync pushes every change on its own, the dialog only redraws when it
// is the one showing the list
export function autoPush() {
    if (!state.autoSync || !state.syncPath || !hasUnsyncedChanges())
        return;
    recordPush();
    if (overlay.querySelector('.pref-sync-dialog'))
        views.renderModal();
}

function hasUnsyncedChanges() {
    return state.syncPending || !state.sampleSyncTime;
}

// Each write leaves one more entry, the old file or, on the first write, the
// new one, so the list never starts empty. Newest first, the oldest beyond
// the limit falls off.
function recordPush() {
    const time = syncTimestamp(new Date());
    const backups = [{time}, ...state.sampleBackups || []].slice(0, state.backups);
    state.sampleBackups = backups.map((backup, i) => ({...backup, index: i + 1}));
    state.sampleSyncTime = time;
    state.syncPending = false;
    expandExpander('backups');
}

export function confirmPull() {
    openAlert({
        heading: _('Pull from file?'),
        body: _('App settings are merged; other settings are taken from the file.'),
        confirmLabel: _('Pull'),
        onConfirm: pullFromFile,
    });
}

export function confirmDeleteBackup(index) {
    openAlert({
        heading: _('Delete this backup?'),
        body: _('The backup file will be permanently removed.'),
        confirmLabel: _('Delete'),
        onConfirm: () => {
            state.sampleBackups = state.sampleBackups.filter(backup => backup.index !== index);
            views.renderModal();
            toast(_('Backup deleted'));
        },
    });
}

export function confirmRestoreBackup() {
    openAlert({heading: _('Restore this backup?'), body: _('Local settings will be overwritten.'), confirmLabel: _('Restore'), onConfirm: () => toast(_('Backup restored'))});
}

function revealSampleBackups() {
    expandExpander('backups');
    if (state.sampleBackups?.length)
        return;
    const now = Date.now();
    state.sampleBackups = Array.from({length: SAMPLE_BACKUP_COUNT}, (_unused, i) => ({index: i + 1, time: syncTimestamp(new Date(now - i * HOUR_MS))}));
    state.sampleSyncTime = syncTimestamp(new Date(now));
}

function syncTimestamp(date) {
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
