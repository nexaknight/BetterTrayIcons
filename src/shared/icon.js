import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn} from './logging.js';
import {readFileBytes} from './fetch.js';
import {ICON_CACHE_SUBDIR} from '../const.js';

// ------- Icon resolution -------

export function resolveIcon(config) {
    if (!config)
        return {type: 'name', value: 'image-missing'};

    if (config.custom_icon) {
        if (config.custom_icon.startsWith('/'))
            return {type: 'file', value: config.custom_icon};

        return {type: 'name', value: config.custom_icon};
    }

    // Without this check, a stale cached path would show as image-missing.
    if (config.cached_icon_path) {
        const f = Gio.File.new_for_path(config.cached_icon_path);
        if (f.query_exists(null))
            return {type: 'file', value: config.cached_icon_path};
    }

    const iconName = config.detected_icon;

    if (iconName) {
        if (iconName.startsWith('/'))
            return {type: 'file', value: iconName};

        if (config.icon_theme_path) {
            const resolvedPath = findIconInTheme(iconName, config.icon_theme_path);
            if (resolvedPath)
                return {type: 'file', value: resolvedPath};
        }

        return {type: 'name', value: iconName};
    }

    return {type: 'name', value: 'image-missing'};
}

export function findIconInTheme(iconName, themePath) {
    if (!iconName || !themePath)
        return null;

    const extensions = ['.png', '.svg', '.xpm', '.ico', ''];
    const candidates = [iconName];
    extensions.forEach(ext => candidates.push(`${iconName}${ext}`));

    for (const cand of candidates) {
        const cleanPath = themePath.endsWith('/') ? themePath : `${themePath}/`;
        const fullPath = `${cleanPath}${cand}`;
        const f = Gio.File.new_for_path(fullPath);
        if (f.query_exists(null))
            return fullPath;
    }
    return null;
}

// Used by both prefs and shell.
export function themedIconWithFallback(name) {
    return new Gio.ThemedIcon({names: [name || 'image-missing', 'image-missing']});
}

export function pathOrThemedIcon(value) {
    if (!value)
        return themedIconWithFallback('image-missing');
    if (value.startsWith('/')) {
        const file = Gio.File.new_for_path(value);
        return file.query_exists(null)
            ? new Gio.FileIcon({file})
            : themedIconWithFallback('image-missing');
    }
    return themedIconWithFallback(value);
}

// `useSymbolic` puts the `-symbolic` variant first.
export function buildSymbolicCandidates(name, useSymbolic) {
    if (!name)
        return [];
    const candidates = [];
    if (useSymbolic) {
        if (!name.endsWith('-symbolic'))
            candidates.push(`${name}-symbolic`);
        candidates.push(name);
    } else {
        candidates.push(name);
        if (!name.endsWith('-symbolic'))
            candidates.push(`${name}-symbolic`);
    }
    return candidates;
}

// ------- Icon cache -------

let _cacheDirPath = null;

// Skip write if content matches existing file.
export async function writeCachedIcon(appId, pngBytes) {
    if (!appId || !pngBytes || pngBytes.length === 0)
        return null;
    const path = _cachedIconPath(appId);
    const file = Gio.File.new_for_path(path);

    try {
        if (file.query_exists(null)) {
            const existing = await readFileBytes(file);
            if (existing.length === pngBytes.length && _bytesEqual(existing, pngBytes))
                return path;
        }

        // Async so a frame's cache write never blocks the compositor.
        await new Promise((resolve, reject) => {
            file.replace_contents_async(
                GLib.Bytes.new(pngBytes),
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
        return path;
    } catch (e) {
        warn(`iconCache: write failed for ${appId}: ${e.message}`);
        return null;
    }
}

// Best-effort cleanup. File can vanish between the exists check and the delete.
export function deleteCachedIcon(appId) {
    if (!appId)
        return;
    const path = _cachedIconPath(appId);
    const file = Gio.File.new_for_path(path);
    try {
        if (file.query_exists(null))
            file.delete(null);
    } catch { /* gone */ }
}

function _cachedIconPath(appId) {
    if (!appId)
        return null;
    const dir = _ensureCacheDir();
    return GLib.build_filenamev([dir, `${appId}.png`]);
}

function _ensureCacheDir() {
    if (_cacheDirPath)
        return _cacheDirPath;
    _cacheDirPath = GLib.build_filenamev([GLib.get_user_cache_dir(), ICON_CACHE_SUBDIR]);
    const dir = Gio.File.new_for_path(_cacheDirPath);
    if (!dir.query_exists(null)) {
        try {
            dir.make_directory_with_parents(null);
        } catch (e) {
            warn(`iconCache: could not create ${_cacheDirPath}: ${e.message}`);
        }
    }
    return _cacheDirPath;
}

function _bytesEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }

    return true;
}
