import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn, error} from './logging.js';
import {safeMapFromParsed} from './appConfig.js';
import {COLOR_PATTERN} from '../const.js';

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

    // The sync file often lives on a network mount, so every write here
    // is async to keep the calling main loop responsive.
    const file = Gio.File.new_for_path(path);
    await new Promise((resolve, reject) => {
        file.replace_contents_async(
            GLib.Bytes.new(new TextEncoder().encode(jsonString)),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (obj, res) => {
                try {
                    obj.replace_contents_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

export async function loadSettingsFromFile(settings, path) {
    const file = Gio.File.new_for_path(path);
    let jsonString;

    if (path.endsWith('.gz')) {
        const fileStream = await new Promise((resolve, reject) => {
            file.read_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
                try {
                    resolve(obj.read_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
        const decompressor = Gio.ZlibDecompressor.new(Gio.ZlibCompressorFormat.GZIP);
        const converterStream = Gio.ConverterInputStream.new(fileStream, decompressor);
        const outStream = Gio.MemoryOutputStream.new_resizable();
        await new Promise((resolve, reject) => {
            outStream.splice_async(
                converterStream,
                Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
                GLib.PRIORITY_DEFAULT,
                null,
                (obj, res) => {
                    try {
                        obj.splice_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
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

// Backups live next to the sync file as `<path>.<n>.gz`, plain `.<n>`
// from old versions. One directory enumeration replaces stat-probing
// every candidate slot, which hurts on network mounts.
export async function listBackups(path) {
    const file = Gio.File.new_for_path(path);
    const parent = file.get_parent();
    if (!parent)
        return [];

    const base = file.get_basename();
    const backups = [];
    try {
        const enumerator = await new Promise((resolve, reject) => {
            parent.enumerate_children_async(
                'standard::name,time::modified',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (obj, res) => {
                    try {
                        resolve(obj.enumerate_children_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        for await (const info of enumerator) {
            const name = info.get_name();
            if (!name.startsWith(`${base}.`))
                continue;
            const match = name.slice(base.length).match(/^\.(\d+)(\.gz)?$/);
            if (!match)
                continue;
            backups.push({
                index: parseInt(match[1], 10),
                path: parent.get_child(name).get_path(),
                compressed: !!match[2],
                mtime: info.get_modification_date_time(),
            });
        }
    } catch {
        // Directory unreadable or gone, nothing to list.
        return [];
    }

    backups.sort((a, b) => a.index - b.index);
    return backups;
}

export async function deleteBackups(path) {
    if (!path)
        return;
    const backups = await listBackups(path);
    await Promise.all([_deleteAsync(path), ...backups.map(b => _deleteAsync(b.path))]);
}

export function deleteBackup(path, index) {
    if (!path || !index)
        return Promise.resolve();
    return _deleteAsync(`${path}.${index}.gz`);
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
    const backups = (await listBackups(path)).filter(b => b.compressed);

    // Drop slots above the new ceiling so a lowered max-backups doesn't
    // leave orphaned files behind.
    const stale = backups.filter(b => b.index > maxBackups);
    await Promise.all(stale.map(b => _deleteAsync(b.path)));

    // Shift N to N+1, highest first so no move lands on an occupied slot
    // that still has to move itself.
    const toShift = backups
        .filter(b => b.index <= maxBackups - 1)
        .sort((a, b) => b.index - a.index);
    /* eslint-disable no-await-in-loop */
    for (const b of toShift)
        await _moveAsync(b.path, `${path}.${b.index + 1}.gz`);
    /* eslint-enable no-await-in-loop */

    const mainFile = Gio.File.new_for_path(path);
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
        await _writeCompressed(`${path}.1.gz`, content);
    } catch (e) {
        // A missing main file just means there's nothing to back up yet.
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            error(`Backup compression failed: ${e.message}`, e);
    }
}

async function _writeCompressed(path, content) {
    const file = Gio.File.new_for_path(path);
    const fileStream = await new Promise((resolve, reject) => {
        file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
            try {
                resolve(obj.replace_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });

    const compressor = Gio.ZlibCompressor.new(Gio.ZlibCompressorFormat.GZIP, -1);
    const converterStream = Gio.ConverterOutputStream.new(fileStream, compressor);

    await new Promise((resolve, reject) => {
        converterStream.write_all_async(content, GLib.PRIORITY_DEFAULT, null, (obj, res) => {
            try {
                obj.write_all_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
    await new Promise((resolve, reject) => {
        converterStream.close_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
            try {
                obj.close_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

function _moveAsync(sourcePath, destPath) {
    return new Promise(resolve => {
        const source = Gio.File.new_for_path(sourcePath);
        const dest = Gio.File.new_for_path(destPath);
        source.move_async(dest, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (obj, res) => {
            try {
                obj.move_finish(res);
            } catch (e) {
                warn(`Backup rotation failed for ${sourcePath} -> ${destPath}: ${e.message}`);
            }
            resolve();
        });
    });
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

// No exists pre-check: deleting a missing file just errors out, and the
// error is swallowed either way.
function _deleteAsync(path) {
    return new Promise(resolve => {
        Gio.File.new_for_path(path).delete_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
            try {
                obj.delete_finish(res);
            } catch { /* gone or never existed */ }
            resolve();
        });
    });
}
