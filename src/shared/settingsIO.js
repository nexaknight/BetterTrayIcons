import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn, warnOnce, error} from './logging.js';
import {safeMapFromParsed, getAppConfigMap, getSyncMeta, mergeAppConfigs, syncMetaForReplace} from './appConfig.js';
import {readFileBytes, readFileText, probePaths} from './asyncIo.js';
import {BADGE_POSITIONS} from '../const.js';
import {ACCENT_COLOR_VALUE, accentValueKeeping} from './accentColor.js';
import {LIGHT_SUFFIX} from './colorVariant.js';

const COLOR_KEY_PATTERN = new RegExp(`-color(${LIGHT_SUFFIX})?$`);

// Colors feed inline set_style() strings, filter against CSS injection.
const COLOR_LITERAL = '#[0-9a-f]{3,8}|rgba?\\(\\s*[\\d.,\\s]+\\s*\\)';
const COLOR_PATTERN = new RegExp(
    `^(${COLOR_LITERAL}|${ACCENT_COLOR_VALUE}(:(${COLOR_LITERAL}))?)$`, 'i');

// A pull must not rewire the sync it arrived through. Importing another
// host's file path or auto switch retargets or severs the link.
const IMPORT_EXCLUDED_KEYS = new Set(['sync-file-path', 'enable-auto-sync']);

const ACCENT_KEY_SUFFIX = 'use-accent-color';

// Await this before importSettingsFromJSON, which has to stay synchronous so
// the shell's _isImporting flag spans exactly its own writes.
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
    const configValues = configs && typeof configs === 'object' ? Object.values(configs) : [];

    for (const config of configValues) {
        if (!config || typeof config !== 'object')
            continue;
        const states = config.state_icons;
        const isStateMap = _isPlainObject(states);
        if (isStateMap)
            Object.values(states).forEach(collect);
        collect(config.custom_icon);
    }

    return probePaths(paths, cancellable);
}

export function importSettingsFromJSON(settings, data, iconPaths, {merge = false} = {}) {
    if (!data || typeof data !== 'object')
        return;

    const batch = new Gio.Settings({settings_schema: settings.settings_schema});
    batch.delay();

    const keys = batch.list_keys();
    const homeDir = GLib.get_home_dir();
    let syncMeta;
    const legacyAccentColorKeys = [];

    Object.keys(data).forEach(key => {
        if (key.endsWith(ACCENT_KEY_SUFFIX)) {
            if (data[key] === true)
                legacyAccentColorKeys.push(`${key.slice(0, -ACCENT_KEY_SUFFIX.length)}color`);
            return;
        }

        // The sync metadata travels as _app_config_meta and is applied together
        // with app-configs below, never set from a raw key.
        if (!keys.includes(key) || IMPORT_EXCLUDED_KEYS.has(key) || key === 'app-config-sync-meta')
            return;

        let value = data[key];

        if (_isMalformedColor(key, value)) {
            warn(`Import: Skipping malformed color for '${key}': ${value}`);
            return;
        }

        if (typeof value === 'string')
            value = _expandHome(value, homeDir);

        if (key === 'app-configs' && typeof value === 'object') {
            const incoming = safeMapFromParsed(value, (appId, config) =>
                _sanitizeAppConfigForImport(appId, config, homeDir, iconPaths));
            const fallbackTs = Number.isFinite(data._meta?.timestamp) ? data._meta.timestamp : Date.now();
            if (merge) {
                const merged = mergeAppConfigs(getAppConfigMap(settings), getSyncMeta(settings),
                    incoming, data._app_config_meta, fallbackTs);
                value = JSON.stringify(merged.map);
                syncMeta = merged.meta;
            } else {
                value = JSON.stringify(incoming);
                syncMeta = syncMetaForReplace(incoming, data._app_config_meta, fallbackTs);
            }
        }

        const typeString = batch.get_value(key).get_type_string();
        try {
            batch.set_value(key, GLib.Variant.new(typeString, value));
        } catch (e) {
            warn(`Failed to import key '${key}': ${e.message}`);
        }
    });

    legacyAccentColorKeys
        .filter(colorKey => keys.includes(colorKey))
        .forEach(colorKey => batch.set_string(colorKey, accentValueKeeping(batch.get_string(colorKey))));

    if (syncMeta && keys.includes('app-config-sync-meta'))
        batch.set_string('app-config-sync-meta', JSON.stringify(syncMeta));

    batch.apply();
}

// delay() on the shared instance would leave it delayed for good.
export function resetKeys(settings, keys) {
    const batch = new Gio.Settings({settings_schema: settings.settings_schema});
    batch.delay();
    keys.forEach(key => batch.reset(key));
    batch.apply();
}

export function isOwnSyncSource(meta) {
    return meta?.source === GLib.get_host_name();
}

// The main file is last-writer-wins, and two saves started in one order can
// finish in the other.
let _pendingSave = Promise.resolve();

export function saveSettingsToFile(settings, path) {
    const done = _pendingSave.then(() => _writeSettingsFile(settings, path));
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
        warnOnce(`backups:${path}`, `Cannot list backups next to '${path}': ${e.message}`);
        return [];
    }

    backups.sort(_byNewestFirst);
    backups.forEach((b, i) => {
        b.index = i + 1;
    });
    return backups;
}

// The usec attribute has to be asked for, and without it a whole burst of
// saves lands in one second and ties. The number in the name breaks that tie,
// this version writes a microsecond timestamp there so higher is newer.
function _byNewestFirst(a, b) {
    if (!a.mtime || !b.mtime)
        return (b.mtime ? 1 : 0) - (a.mtime ? 1 : 0);
    return b.mtime.difference(a.mtime) || b.stamp - a.stamp;
}

export async function deleteBackups(path) {
    const backups = await listBackups(path);
    await Promise.all([deleteBackup(path), ...backups.map(b => deleteBackup(b.path))]);
}

export async function deleteBackup(path) {
    try {
        await Gio.File.new_for_path(path).delete_async(GLib.PRIORITY_DEFAULT, null);
    } catch { /* gone or never existed */ }
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

    if (path.endsWith('.gz'))
        await _writeCompressed(path, encoded);
    else
        await _writeBytes(path, encoded);
}

function _writeBytes(path, bytes) {
    return Gio.File.new_for_path(path).replace_contents_async(
        new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

async function _fileAlreadyHolds(path, data) {
    try {
        const {_meta: unusedOnDisk, ...onDisk} = await _readSettingsFile(path);
        const {_meta: unusedFresh, ...fresh} = data;
        return _stableStringify(onDisk) === _stableStringify(fresh);
    } catch {
        return false;
    }
}

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
        if (key === 'app-config-sync-meta')
            return;

        const variant = settings.get_value(key);
        let value = variant.deep_unpack();

        if (key === 'app-configs' && typeof value === 'string') {
            try {
                value = JSON.parse(value);
                Object.values(value).forEach(config => _collapseIconPaths(config, homeDir));
            } catch { /* keep raw string */ }
        }

        if (typeof value === 'string' && value.startsWith(homeDir))
            value = _collapseHome(value, homeDir);

        exportData[key] = value;
    });

    exportData['_app_config_meta'] = getSyncMeta(settings);

    return exportData;
}

function _collapseIconPaths(config, homeDir) {
    if (typeof config.custom_icon === 'string' && config.custom_icon.startsWith(homeDir))
        config.custom_icon = _collapseHome(config.custom_icon, homeDir);

    for (const [state, icon] of Object.entries(config.state_icons ?? {})) {
        if (typeof icon === 'string' && icon.startsWith(homeDir))
            config.state_icons[state] = _collapseHome(icon, homeDir);
    }
}

// Every backup gets its own name instead of shifting slots. Shell and prefs
// can write at the same time, and interleaved shifts lost whole generations.
async function _writeBackup(path, maxBackups) {
    const mainFile = Gio.File.new_for_path(path);
    let content;
    try {
        content = await readFileBytes(mainFile);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            error(`Backup read failed: ${e.message}`, e);
        return;
    }

    try {
        const backupPath = `${path}.${GLib.get_real_time()}.gz`;
        // Recompressing would nest two gzip layers, and the restore path
        // unwraps only one.
        if (path.endsWith('.gz'))
            await _writeBytes(backupPath, content);
        else
            await _writeCompressed(backupPath, content);
    } catch (e) {
        error(`Backup compression failed: ${e.message}`, e);
        return;
    }

    const backups = await listBackups(path);
    await Promise.all(backups.slice(maxBackups).map(b => deleteBackup(b.path)));
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

function _isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _isMalformedColor(key, value) {
    return COLOR_KEY_PATTERN.test(key) && typeof value === 'string' && !COLOR_PATTERN.test(value);
}

function _collapseHome(value, homeDir) {
    return value.replace(homeDir, '$HOME');
}

function _expandHome(value, homeDir) {
    return value.includes('$HOME') ? value.split('$HOME').join(homeDir) : value;
}

function _isMissingIcon(path, iconPaths) {
    return path.startsWith('/') && iconPaths.get(path) === false;
}

function _sanitizeAppConfigForImport(appId, appConfig, homeDir, iconPaths) {
    if (!_isPlainObject(appConfig))
        return null;

    if (appConfig.state_icons && !_isPlainObject(appConfig.state_icons))
        delete appConfig.state_icons;

    for (const [state, icon] of Object.entries(appConfig.state_icons ?? {})) {
        if (typeof icon !== 'string')
            continue;
        const resolved = _expandHome(icon, homeDir);
        appConfig.state_icons[state] = resolved;
        if (_isMissingIcon(resolved, iconPaths)) {
            warn(`Import: Dropping state ${state} of ${appId}, icon not found: ${resolved}`);
            delete appConfig.state_icons[state];
        }
    }

    _sanitizeBadgeFields(appConfig);

    // A non-string here reaches resolveIcon, which calls startsWith on it and
    // takes the whole tray item setup down with a TypeError.
    if (typeof appConfig.custom_icon !== 'string') {
        delete appConfig.custom_icon;
        return appConfig;
    }

    appConfig.custom_icon = _expandHome(appConfig.custom_icon, homeDir);

    // Returning null here would drop the whole entry, and the next auto-push
    // would spread that loss to every host.
    if (_isMissingIcon(appConfig.custom_icon, iconPaths)) {
        warn(`Import: Dropping custom icon of ${appId}, not found: ${appConfig.custom_icon}`);
        delete appConfig.custom_icon;
    }

    return appConfig;
}

// The dialog mutates badge_style in place and the shell splices its colors
// into inline St css, so a synced blob must not deliver other shapes.
function _sanitizeBadgeFields(appConfig) {
    if (appConfig.unread_badge !== true)
        delete appConfig.unread_badge;

    const style = appConfig.badge_style;
    if (!_isPlainObject(style)) {
        delete appConfig.badge_style;
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
        delete appConfig.badge_style;
}

