import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn, warnOnce, error} from './logging.js';
import {safeMapFromParsed, getAppConfigMap, getSyncMeta, mergeAppConfigs, syncMetaForReplace} from './appConfig.js';
import {readFileBytes, readFileText, probePaths} from './fetch.js';
import {BADGE_POSITIONS} from '../const.js';

// Colors feed inline set_style() strings, filter against CSS injection.
const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.,\s]+\s*\))$/i;

// A pull must not rewire the sync it arrived through: importing another
// host's file path or auto switch retargets or severs the link.
const IMPORT_EXCLUDED_KEYS = new Set(['sync-file-path', 'enable-auto-sync']);

// Await this before importSettingsFromJSON, which has to stay synchronous so
// the shell's _importing flag spans exactly its own writes.
export function probeImportIconPaths(data, cancellable = null) {
    const homeDir = GLib.get_home_dir();
    const paths = new Set();

    const collect = icon => {
        if (typeof icon !== 'string')
            return;
        const resolved = _expandHome(icon, homeDir);
        if (resolved.startsWith('/'))
            paths.add(resolved);
    };

    const configs = data?.['app-configs'];
    if (configs && typeof configs === 'object') {
        for (const conf of Object.values(configs)) {
            if (!conf || typeof conf !== 'object')
                continue;
            const states = conf.state_icons;
            if (states && typeof states === 'object' && !Array.isArray(states))
                Object.values(states).forEach(collect);
            collect(conf.custom_icon);
        }
    }

    return probePaths(paths, cancellable);
}

export function importSettingsFromJSON(settings, data, iconPaths, {merge = false} = {}) {
    if (!data || typeof data !== 'object')
        return;

    // A scratch instance in delay mode turns the import into one dconf
    // transaction instead of a write plus signal fan-out per key.
    const batch = new Gio.Settings({settings_schema: settings.settings_schema});
    batch.delay();

    const keys = batch.list_keys();
    const homeDir = GLib.get_home_dir();
    // Written once after the loop, when the file carried app-configs, so the
    // local sync metadata matches whatever landed.
    let syncMeta;

    Object.keys(data).forEach(key => {
        // The sync metadata travels as _app_config_meta and is applied together
        // with app-configs below, never set from a raw key.
        if (!keys.includes(key) || IMPORT_EXCLUDED_KEYS.has(key) || key === 'app-config-sync-meta')
            return;

        let val = data[key];

        if (_isMalformedColor(key, val)) {
            warn(`Import: Skipping malformed color for '${key}': ${val}`);
            return;
        }

        if (typeof val === 'string')
            val = _expandHome(val, homeDir);

        // app-configs is stored as a JSON string in GSettings, so re-encode it.
        // A pull merges per app so no host loses an entry, a restore or plain
        // import replaces, both reconciling the sync metadata alongside.
        if (key === 'app-configs' && typeof val === 'object') {
            const incoming = safeMapFromParsed(val, (appId, conf) =>
                _sanitizeAppConfigForImport(appId, conf, homeDir, iconPaths));
            const fallbackTs = Number.isFinite(data._meta?.timestamp) ? data._meta.timestamp : Date.now();
            if (merge) {
                const merged = mergeAppConfigs(getAppConfigMap(settings), getSyncMeta(settings),
                    incoming, data._app_config_meta, fallbackTs);
                val = JSON.stringify(merged.map);
                syncMeta = merged.meta;
            } else {
                val = JSON.stringify(incoming);
                syncMeta = syncMetaForReplace(incoming, data._app_config_meta, fallbackTs);
            }
        }

        const typeString = batch.get_value(key).get_type_string();
        try {
            batch.set_value(key, GLib.Variant.new(typeString, val));
        } catch (e) {
            warn(`Failed to import key '${key}': ${e.message}`);
        }
    });

    if (syncMeta && keys.includes('app-config-sync-meta'))
        batch.set_string('app-config-sync-meta', JSON.stringify(syncMeta));

    batch.apply();
}

// Same scratch-instance transaction as the import above. delay() on the
// shared instance would leave it delayed for good.
export function resetKeys(settings, keys) {
    const batch = new Gio.Settings({settings_schema: settings.settings_schema});
    batch.delay();
    keys.forEach(key => batch.reset(key));
    batch.apply();
}

// Backup names no longer collide, but the main file is still last-writer-wins,
// and two saves started in one order can finish in the other. Queueing them
// keeps the file holding what the last caller asked for.
let _pendingSave = Promise.resolve();

export function isOwnSyncSource(meta) {
    return meta?.source === GLib.get_host_name();
}

export function saveSettingsToFile(settings, path) {
    const done = _pendingSave.then(() => _writeSettingsFile(settings, path));
    // Only the queue tail swallows, the caller still gets the rejection.
    _pendingSave = done.catch(() => {});
    return done;
}

export async function loadSettingsFromFile(settings, path, {merge = false} = {}) {
    const data = await _readSettingsFile(path);
    importSettingsFromJSON(settings, data, await probeImportIconPaths(data), {merge});
}

async function _readSettingsFile(path) {
    const file = Gio.File.new_for_path(path);
    let jsonString;

    if (path.endsWith('.gz')) {
        const fileStream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
        const decompressor = Gio.ZlibDecompressor.new(Gio.ZlibCompressorFormat.GZIP);
        const converterStream = Gio.ConverterInputStream.new(fileStream, decompressor);
        const outStream = Gio.MemoryOutputStream.new_resizable();
        await outStream.splice_async(
            converterStream,
            Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
            GLib.PRIORITY_DEFAULT,
            null
        );
        jsonString = new TextDecoder().decode(outStream.steal_as_bytes().get_data());
    } else {
        jsonString = await readFileText(file);
    }

    return JSON.parse(jsonString);
}

// Old versions wrote the backups uncompressed, hence the optional `.gz`.
// One directory enumeration instead of stat-probing every candidate slot,
// which hurts on network mounts.
export async function listBackups(path) {
    const file = Gio.File.new_for_path(path);
    const parent = file.get_parent();
    if (!parent)
        return [];

    const base = file.get_basename();
    const backups = [];
    try {
        const enumerator = await parent.enumerate_children_async(
            'standard::name,time::modified,time::modified-usec',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null
        );

        for await (const info of enumerator) {
            const name = info.get_name();
            if (!name.startsWith(`${base}.`))
                continue;
            const match = name.slice(base.length).match(/^\.(\d+)(\.gz)?$/);
            if (!match)
                continue;
            backups.push({
                stamp: parseInt(match[1], 10),
                path: parent.get_child(name).get_path(),
                mtime: info.get_modification_date_time(),
            });
        }
    } catch (e) {
        // With no listing the retention cannot prune either, so say why.
        warnOnce(`backups:${path}`, `Cannot list backups next to '${path}': ${e.message}`);
        return [];
    }

    // Newest first, by mtime rather than by the number in the name. The number
    // is a timestamp for anything this version wrote, but the releases before
    // it counted slots, and a rename carries the mtime over, so both orders
    // come out right and the two kinds can sit in one directory. The index is
    // the position in that order, so it stays 1..N with no gaps even after a
    // concurrent write dropped one.
    backups.sort(_byNewestFirst);
    backups.forEach((b, i) => {
        b.index = i + 1;
    });
    return backups;
}

// The usec attribute has to be asked for, and without it a whole burst of saves
// lands in one second and ties. The number in the name breaks that tie: this
// version writes a microsecond timestamp there, so higher is newer.
function _byNewestFirst(a, b) {
    if (!a.mtime || !b.mtime)
        return (b.mtime ? 1 : 0) - (a.mtime ? 1 : 0);
    return b.mtime.difference(a.mtime) || b.stamp - a.stamp;
}

export async function deleteBackups(path) {
    const backups = await listBackups(path);
    await Promise.all([_deleteAsync(path), ...backups.map(b => _deleteAsync(b.path))]);
}

// Deriving the path from the position would address a different file as
// soon as another writer added or pruned one.
export function deleteBackup(backupPath) {
    if (!backupPath)
        return Promise.resolve();
    return _deleteAsync(backupPath);
}

async function _writeSettingsFile(settings, path) {
    const data = _exportSettingsToJSON(settings);

    // A pull applies the file's own settings, which the other process sees as a
    // change and answers with a push. Without this it would spend a backup on
    // an identical file and stamp its own host into _meta, so the sync dialog
    // then credits this machine for settings it just received.
    if (await _fileAlreadyHolds(path, data))
        return;

    await _writeBackup(path, settings.get_int('max-backups'));
    const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));

    // The sync file often lives on a network mount, so every write here
    // is async to keep the calling main loop responsive.
    // A .gz path reads back through the gunzip branch, so it has to be
    // written compressed or the next pull throws on it.
    if (path.endsWith('.gz'))
        await _writeCompressed(path, encoded);
    else
        await _writeBytes(path, encoded);
}

function _writeBytes(path, bytes) {
    return Gio.File.new_for_path(path).replace_contents_async(
        new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

// _meta carries the writing host and a timestamp, so it differs on every
// export and would never match.
async function _fileAlreadyHolds(path, data) {
    try {
        const {_meta: unusedOnDisk, ...onDisk} = await _readSettingsFile(path);
        const {_meta: unusedFresh, ...fresh} = data;
        return _stableStringify(onDisk) === _stableStringify(fresh);
    } catch {
        return false;
    }
}

// A merge builds the map in its own key order, so compare by content, not byte
// layout, or two hosts would keep reordering the file back and forth.
function _stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(_stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key =>
        `${JSON.stringify(key)}:${_stableStringify(value[key])}`).join(',')}}`;
}

function _exportSettingsToJSON(settings) {
    const keys = settings.list_keys();
    const exportData = {};
    const homeDir = GLib.get_home_dir();

    // Used on import to skip changes this host wrote itself.
    exportData['_meta'] = {
        source: GLib.get_host_name(),
        timestamp: Date.now(),
    };

    keys.forEach(key => {
        // Emitted parsed as _app_config_meta below so a pull can read the stamps.
        if (key === 'app-config-sync-meta')
            return;

        const val = settings.get_value(key);
        let nativeVal = val.deep_unpack();

        if (key === 'app-configs' && typeof nativeVal === 'string') {
            try {
                nativeVal = JSON.parse(nativeVal);

                Object.keys(nativeVal).forEach(appId => {
                    const conf = nativeVal[appId];
                    if (conf.custom_icon && typeof conf.custom_icon === 'string' && conf.custom_icon.startsWith(homeDir))
                        conf.custom_icon = _collapseHome(conf.custom_icon, homeDir);
                    for (const [state, icon] of Object.entries(conf.state_icons ?? {})) {
                        if (typeof icon === 'string' && icon.startsWith(homeDir))
                            conf.state_icons[state] = _collapseHome(icon, homeDir);
                    }
                });
            } catch { /* keep raw string */ }
        }

        if (typeof nativeVal === 'string' && nativeVal.startsWith(homeDir))
            nativeVal = _collapseHome(nativeVal, homeDir);

        exportData[key] = nativeVal;
    });

    exportData['_app_config_meta'] = getSyncMeta(settings);

    return exportData;
}

// Each backup gets a name of its own instead of everything shifting up a slot.
// Two processes can write the sync file at once (the shell auto-pushes while
// the prefs push), and the old shift interleaved: measured over three runs it
// left holes in the chain, the same generation in two slots, and whole
// generations gone. Distinct names cannot collide, so this needs no lock, which
// also keeps it working on the network mounts these files tend to live on,
// where advisory locks are not dependable.
async function _writeBackup(path, maxBackups) {
    const mainFile = Gio.File.new_for_path(path);
    let content;
    try {
        content = await readFileBytes(mainFile);
    } catch (e) {
        // A missing main file just means there's nothing to back up yet.
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            error(`Backup read failed: ${e.message}`, e);
        return;
    }

    try {
        const backupPath = `${path}.${GLib.get_real_time()}.gz`;
        // A .gz main file is already compressed. Recompressing would nest two
        // gzip layers, and the restore path unwraps only one.
        if (path.endsWith('.gz'))
            await _writeBytes(backupPath, content);
        else
            await _writeCompressed(backupPath, content);
    } catch (e) {
        error(`Backup compression failed: ${e.message}`, e);
        return;
    }

    const backups = await listBackups(path);
    await Promise.all(backups.slice(maxBackups).map(b => _deleteAsync(b.path)));
}

async function _writeCompressed(path, content) {
    const file = Gio.File.new_for_path(path);
    const fileStream = await file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null);

    const compressor = Gio.ZlibCompressor.new(Gio.ZlibCompressorFormat.GZIP, -1);
    const converterStream = Gio.ConverterOutputStream.new(fileStream, compressor);

    // write_all_async does not hold the buffer for the duration of the write,
    // which lands freed memory at the head of every backup and leaves the JSON
    // unparseable. A GLib.Bytes is refcounted and survives the await.
    const source = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(content));
    await converterStream.splice_async(
        source,
        Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
        GLib.PRIORITY_DEFAULT,
        null
    );
}


function _isMalformedColor(key, val) {
    return key.includes('color') && typeof val === 'string' && !COLOR_PATTERN.test(val);
}

function _collapseHome(value, homeDir) {
    return value.replace(homeDir, '$HOME');
}

function _expandHome(value, homeDir) {
    return value.includes('$HOME') ? value.split('$HOME').join(homeDir) : value;
}

// An unprobed path is left alone rather than dropped.
function _isMissingIcon(path, iconPaths) {
    return path.startsWith('/') && iconPaths.get(path) === false;
}

function _sanitizeAppConfigForImport(appId, appConf, homeDir, iconPaths) {
    if (!appConf || typeof appConf !== 'object' || Array.isArray(appConf))
        return null;

    // A string here would have Object.entries walk its characters and the
    // loop below assign to a read-only index.
    if (appConf.state_icons && (typeof appConf.state_icons !== 'object' || Array.isArray(appConf.state_icons)))
        delete appConf.state_icons;

    for (const [state, icon] of Object.entries(appConf.state_icons ?? {})) {
        if (typeof icon !== 'string')
            continue;
        const resolved = _expandHome(icon, homeDir);
        appConf.state_icons[state] = resolved;
        if (_isMissingIcon(resolved, iconPaths)) {
            warn(`Import: Dropping state ${state} of ${appId}, icon not found: ${resolved}`);
            delete appConf.state_icons[state];
        }
    }

    _sanitizeBadgeFields(appConf);

    // A non-string here reaches resolveIcon, which calls startsWith on it and
    // takes the whole tray item setup down with a TypeError.
    if (typeof appConf.custom_icon !== 'string') {
        delete appConf.custom_icon;
        return appConf;
    }

    appConf.custom_icon = _expandHome(appConf.custom_icon, homeDir);

    // Only the icon is unusable. Returning null here would drop the whole
    // entry, and the next auto-push would spread that loss to every host.
    if (_isMissingIcon(appConf.custom_icon, iconPaths)) {
        warn(`Import: Dropping custom icon of ${appId}, not found: ${appConf.custom_icon}`);
        delete appConf.custom_icon;
    }

    return appConf;
}

// The dialog mutates badge_style in place and the shell splices its colors
// into inline St css, so a synced blob must not deliver other shapes.
function _sanitizeBadgeFields(appConf) {
    if (appConf.unread_badge !== true)
        delete appConf.unread_badge;

    const style = appConf.badge_style;
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
        delete appConf.badge_style;
        return;
    }
    if (!BADGE_POSITIONS.includes(style.position))
        delete style.position;
    for (const field of ['radius', 'size']) {
        if (!Number.isFinite(style[field]) || style[field] < 0)
            delete style[field];
    }
    for (const field of ['color', 'text_color']) {
        if (typeof style[field] !== 'string' || !COLOR_PATTERN.test(style[field]))
            delete style[field];
    }
    for (const field of ['color_accent', 'text_color_accent']) {
        if (style[field] !== true)
            delete style[field];
    }
    if (Object.keys(style).length === 0)
        delete appConf.badge_style;
}

async function _deleteAsync(path) {
    try {
        await Gio.File.new_for_path(path).delete_async(GLib.PRIORITY_DEFAULT, null);
    } catch { /* gone or never existed */ }
}
