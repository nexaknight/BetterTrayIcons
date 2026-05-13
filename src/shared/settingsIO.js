import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn, error} from './logging.js';
import {safeMapFromParsed} from './appConfig.js';
import {COLOR_PATTERN, BACKUP_SWEEP_CEILING} from '../const.js';

export function importSettingsFromJSON(settings, data) {
    if (!data || typeof data !== 'object')
        return;

    const keys = settings.list_keys();
    const homeDir = GLib.get_home_dir();

    Object.keys(data).forEach(key => {
        if (!keys.includes(key))
            return;

        let val = data[key];

        if (_isMalformedColor(key, val)) {
            warn(`Import: Skipping malformed color for '${key}': ${val}`);
            return;
        }

        if (typeof val === 'string' && val.includes('$HOME'))
            val = val.split('$HOME').join(homeDir);


        // app-configs is stored as a JSON string in GSettings, so re-encode it.
        if (key === 'app-configs' && typeof val === 'object') {
            val = JSON.stringify(safeMapFromParsed(val, (appId, conf) =>
                _sanitizeAppConfigForImport(appId, conf, homeDir)
            ));
        }

        const typeString = settings.get_value(key).get_type_string();
        try {
            settings.set_value(key, GLib.Variant.new(typeString, val));
        } catch (e) {
            warn(`Failed to import key '${key}': ${e.message}`);
        }
    });
}

export async function saveSettingsToFile(settings, path) {
    await _rotateFile(path, settings.get_int('max-backups'));
    const data = _exportSettingsToJSON(settings);
    const jsonString = JSON.stringify(data, null, 2);

    const file = Gio.File.new_for_path(path);
    file.replace_contents(new TextEncoder().encode(jsonString), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

export async function loadSettingsFromFile(settings, path) {
    const file = Gio.File.new_for_path(path);
    let jsonString;

    if (path.endsWith('.gz')) {
        const fileStream = file.read(null);
        const decompressor = Gio.ZlibDecompressor.new(Gio.ZlibCompressorFormat.GZIP);
        const converterStream = Gio.ConverterInputStream.new(fileStream, decompressor);
        const outStream = Gio.MemoryOutputStream.new_resizable();
        outStream.splice(converterStream, Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET, null);
        jsonString = new TextDecoder().decode(outStream.steal_as_bytes().get_data());
    } else {
        const contents = await new Promise((resolve, reject) => {
            file.load_contents_async(null, (obj, res) => {
                try {
                    const [success, c] = obj.load_contents_finish(res);
                    if (!success) {
                        reject(new Error('Failed to load file'));
                        return;
                    }
                    resolve(c);
                } catch (e) {
                    reject(e);
                }
            });
        });
        jsonString = new TextDecoder().decode(contents);
    }

    importSettingsFromJSON(settings, JSON.parse(jsonString));
}

export function deleteBackups(path) {
    if (!path)
        return;
    _safeDelete(path);
    for (let i = 1; i <= BACKUP_SWEEP_CEILING; i++) {
        _safeDelete(`${path}.${i}.gz`);
        _safeDelete(`${path}.${i}`);
    }
}

export function deleteBackup(path, index) {
    if (!path || !index)
        return;
    _safeDelete(`${path}.${index}.gz`);
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
        const val = settings.get_value(key);
        let nativeVal = val.deep_unpack();

        if (key === 'app-configs' && typeof nativeVal === 'string') {
            try {
                nativeVal = JSON.parse(nativeVal);

                Object.keys(nativeVal).forEach(appId => {
                    const conf = nativeVal[appId];
                    if (conf.custom_icon && typeof conf.custom_icon === 'string' && conf.custom_icon.startsWith(homeDir))
                        conf.custom_icon = conf.custom_icon.replace(homeDir, '$HOME');
                });
            } catch { /* keep raw string */ }
        }

        if (typeof nativeVal === 'string' && nativeVal.startsWith(homeDir))
            nativeVal = nativeVal.replace(homeDir, '$HOME');


        exportData[key] = nativeVal;
    });

    return exportData;
}

async function _rotateFile(path, maxBackups) {
    // Drop any backup slots above the new ceiling so a lowered max-backups
    // doesn't leave orphaned files behind.
    for (let i = maxBackups + 1; i <= BACKUP_SWEEP_CEILING; i++)
        _safeDelete(`${path}.${i}.gz`);


    for (let i = maxBackups - 1; i >= 1; i--) {
        const sourceFile = Gio.File.new_for_path(`${path}.${i}.gz`);
        const destFile = Gio.File.new_for_path(`${path}.${i + 1}.gz`);
        if (sourceFile.query_exists(null)) {
            try {
                sourceFile.move(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
            } catch (e) {
                warn(`Backup rotation failed for ${sourceFile.get_path()} -> ${destFile.get_path()}: ${e.message}`);
            }
        }
    }

    const mainFile = Gio.File.new_for_path(path);
    if (mainFile.query_exists(null)) {
        const backupFile = Gio.File.new_for_path(`${path}.1.gz`);
        try {
            const content = await new Promise((resolve, reject) => {
                mainFile.load_contents_async(null, (obj, res) => {
                    try {
                        const [success, c] = obj.load_contents_finish(res);
                        if (!success) {
                            reject(new Error('Failed to load file'));
                            return;
                        }
                        resolve(c);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            const fileStream = backupFile.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            const compressor = Gio.ZlibCompressor.new(Gio.ZlibCompressorFormat.GZIP, -1);
            const converterStream = Gio.ConverterOutputStream.new(fileStream, compressor);

            converterStream.write_all(content, null);
            converterStream.close(null);
        } catch (e) {
            error(`Backup compression failed: ${e.message}`, e);
        }
    }
}

function _isMalformedColor(key, val) {
    return key.includes('color') && typeof val === 'string' && !COLOR_PATTERN.test(val);
}

// Returns null if the icon path doesn't exist locally.
// Prevents broken paths after sync between machines.
function _sanitizeAppConfigForImport(appId, appConf, homeDir) {
    if (!appConf.custom_icon || typeof appConf.custom_icon !== 'string')
        return appConf;


    if (appConf.custom_icon.includes('$HOME'))
        appConf.custom_icon = appConf.custom_icon.split('$HOME').join(homeDir);


    if (appConf.custom_icon.startsWith('/')) {
        const f = Gio.File.new_for_path(appConf.custom_icon);
        if (!f.query_exists(null)) {
            warn(`Import: Skipping ${appId}, custom icon not found: ${appConf.custom_icon}`);
            return null;
        }
    }

    return appConf;
}

// File can vanish between exists check and delete.
function _safeDelete(path) {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null))
        return;
    try {
        file.delete(null);
    } catch { /* gone */ }
}
