import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import St from 'gi://St';

import {resolveIcon, findIconInTheme, buildSymbolicCandidates, writeCachedIcon} from '../../shared/icon.js';
import {updateAppConfig, getAppConfigValue, setAppConfigValue} from '../../shared/appConfig.js';
import {readFileBytes} from '../../shared/fetch.js';
import {refreshPropertyOnProxy, getProcessInfo} from './dbus.js';

export async function identifyApp(proxy, busName, settings) {
    // The values are independent, so pay one bus latency instead of five.
    const [rawId, title, iconName, iconThemePath, processInfo] = await Promise.all([
        refreshPropertyOnProxy(proxy, 'Id'),
        refreshPropertyOnProxy(proxy, 'Title'),
        refreshPropertyOnProxy(proxy, 'IconName'),
        refreshPropertyOnProxy(proxy, 'IconThemePath'),
        getProcessInfo(proxy, busName),
    ]);
    const processName = processInfo ? processInfo.name : null;
    const isWine = !!(processInfo && processInfo.isWine);

    const picked = _pickAppIdCandidate({processName, rawId, iconThemePath, iconName, title});
    const candidate = picked?.candidate ?? rawId ?? busName.replace(/[:.]/g, '_');
    const isStable = picked?.isStable ?? false;

    const appId = _sanitizeAppId(candidate);

    if (isStable || title) {
        const dataToSave = {
            title: title || candidate,
            detected_icon: iconName,
        };
        if (iconThemePath)
            dataToSave.icon_theme_path = iconThemePath;

        // Persist is_wine so it survives the process exiting.
        if (isWine)
            dataToSave.is_wine = true;
        updateAppConfig(settings, appId, dataToSave);
    }

    return {appId, title: title || candidate, isWine};
}

// One shared theme for has_icon lookups. Constructing St.IconTheme per
// resolution would re-read the theme index every time.
let _sharedIconTheme = null;

export async function resolveTrayIcon(proxy, settings, appId, lastPixmapHash = null) {
    const customIcon = getAppConfigValue(settings, appId, 'custom_icon');

    if (customIcon) {
        const res = resolveIcon({custom_icon: customIcon});

        if (res.type === 'file') {
            const file = Gio.File.new_for_path(res.value);
            return {gicon: new Gio.FileIcon({file}), iconName: null};
        }

        // Same fallback chain as the prefs side so both render identically.
        const useSymbolic = settings.get_boolean('enable-symbolic-icons');
        return {
            gicon: new Gio.ThemedIcon({
                names: buildSymbolicCandidates(res.value, useSymbolic),
                use_default_fallbacks: true,
            }),
            iconName: null,
        };
    }

    if (!proxy)
        return {gicon: null, iconName: 'image-missing'};

    const getStr = async prop => {
        try {
            const val = await refreshPropertyOnProxy(proxy, prop);
            return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
        } catch {
            return null;
        }
    };

    const status = await refreshPropertyOnProxy(proxy, 'Status') ?? 'Passive';

    let attentionName = null;
    if (status === 'NeedsAttention')
        attentionName = await getStr('AttentionIconName');

    const detectedName = await getStr('IconName');
    const iconName = attentionName || detectedName;

    const iconThemePath = await getStr('IconThemePath');
    // Raw values for the caller to persist, saves refetching them there.
    const detected = {iconName: detectedName, iconThemePath};

    if (iconName) {
        if (iconName.startsWith('/')) {
            const file = Gio.File.new_for_path(iconName);
            if (file.query_exists(null)) {
                _snapshotIconToCache(settings, appId, file).catch(() => { /* best-effort */ });
                return {gicon: new Gio.FileIcon({file}), iconName: null, detected};
            }
        } else if (iconThemePath) {
            const resolvedPath = findIconInTheme(iconName, iconThemePath);
            if (resolvedPath) {
                const file = Gio.File.new_for_path(resolvedPath);
                _snapshotIconToCache(settings, appId, file).catch(() => { /* best-effort */ });
                return {gicon: new Gio.FileIcon({file}), iconName: null, detected};
            }
        }
    }

    let themedCandidates = null;
    if (iconName && !iconName.startsWith('/')) {
        const useSymbolic = settings.get_boolean('enable-symbolic-icons');
        themedCandidates = buildSymbolicCandidates(iconName, useSymbolic);
    }

    // Only use the themed icon if it exists in the active theme. Otherwise
    // fall through to the pixmap branch.
    if (themedCandidates && themedCandidates.length > 0) {
        let resolvesInTheme = false;
        try {
            _sharedIconTheme ??= new St.IconTheme();
            resolvesInTheme = themedCandidates.some(n => n && _sharedIconTheme.has_icon(n));
        } catch {
            // Fall through to themed icon when the lookup fails (no theme yet).
            resolvesInTheme = true;
        }

        if (resolvesInTheme) {
            return {
                gicon: new Gio.ThemedIcon({names: themedCandidates, use_default_fallbacks: true}),
                iconName: null,
                detected,
            };
        }
    }

    // Apps without a themable icon end up here. Cache the result to disk so
    // the prefs Applications page renders the same image.
    try {
        let pixmapProp = 'IconPixmap';
        if (status === 'NeedsAttention') {
            const attnPix = await refreshPropertyOnProxy(proxy, 'AttentionIconPixmap');
            if (attnPix && attnPix.length > 0)
                pixmapProp = 'AttentionIconPixmap';
        }

        let pixmap = await refreshPropertyOnProxy(proxy, pixmapProp);
        if ((!pixmap || pixmap.length === 0) && pixmapProp !== 'IconPixmap')
            pixmap = await refreshPropertyOnProxy(proxy, 'IconPixmap');

        if (pixmap && pixmap.length > 0) {
            const targetSize = settings.get_int('icon-size') || 24;
            pixmap.sort((a, b) => {
                const wA = a[0] || 0;
                const wB = b[0] || 0;
                return Math.abs(wA - targetSize) - Math.abs(wB - targetSize);
            });

            const bestMatch = pixmap[0];
            if (bestMatch && bestMatch.length >= 3) {
                const [width, height, rawData] = bestMatch;
                const src = _pixmapBytes(rawData);
                const pixmapHash = src ? _hashPixmap(width, height, src) : null;

                // Animated icons often resend identical frames. Matching the
                // previous hash skips the swizzle, the PNG encode and the
                // cache write.
                if (pixmapHash !== null && pixmapHash === lastPixmapHash && appId) {
                    const cachedPath = getAppConfigValue(settings, appId, 'cached_icon_path');
                    const cachedFile = cachedPath ? Gio.File.new_for_path(cachedPath) : null;
                    if (cachedFile?.query_exists(null))
                        return {gicon: new Gio.FileIcon({file: cachedFile}), iconName: null, detected, pixmapHash};
                }

                const pngBytes = src ? _pixmapToPng(width, height, src) : null;
                if (pngBytes) {
                    if (appId) {
                        const path = await writeCachedIcon(appId, pngBytes);
                        if (path)
                            setAppConfigValue(settings, appId, 'cached_icon_path', path);
                    }
                    const gicon = Gio.BytesIcon.new(GLib.Bytes.new(pngBytes));
                    return {gicon, iconName: null, detected, pixmapHash};
                }
            }
        }
    } catch { /* pixmap decode failed */ }

    if (themedCandidates && themedCandidates.length > 0) {
        return {
            gicon: new Gio.ThemedIcon({names: themedCandidates, use_default_fallbacks: true}),
            iconName: null,
            detected,
        };
    }

    return {gicon: null, iconName: 'image-missing', detected};
}

// Returns {candidate, isStable} or null.
function _pickAppIdCandidate({processName, rawId, iconThemePath, iconName, title}) {
    if (processName)
        return {candidate: processName, isStable: true};

    if (rawId && !_isGenericId(rawId))
        return {candidate: rawId, isStable: true};

    if (iconThemePath) {
        const match = iconThemePath.match(/([a-z0-9-_]+\.[a-z0-9-_]+\.[a-z0-9-_]+)/i);
        if (match && match[1] && !match[1].includes('freedesktop'))
            return {candidate: match[1], isStable: true};
    }

    if (iconName && iconName.length > 2 && !_isGenericIconName(iconName)) {
        const stripped = iconName.replace(/[-_](symbolic|tray|panel)$/i, '');
        if (!_isGenericId(stripped))
            return {candidate: stripped, isStable: true};
    }

    if (title && (!title.includes(' ') || title.length < 20))
        return {candidate: title, isStable: true};

    return null;
}

function _isGenericId(id) {
    if (!id)
        return true;
    const lower = id.toLowerCase();
    return lower.includes('chrome_status_icon') ||
        lower.includes('status_icon') ||
        lower.includes('indicator') ||
        lower.startsWith('state-') ||
        lower.startsWith('libappindicator') ||
        lower.startsWith('task-') ||
        lower === 'app';
}

function _isGenericIconName(name) {
    if (!name)
        return true;
    const lower = name.toLowerCase();
    return lower.startsWith('state-') ||
        lower.startsWith('sync-') ||
        lower === 'image-missing' ||
        lower.includes('panel');
}

function _sanitizeAppId(raw) {
    return raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-._]/g, '');
}

// Some apps store their IconThemePath in an ephemeral directory, so
// copy the bytes into our cache. writeCachedIcon dedupes by content.
async function _snapshotIconToCache(settings, appId, file) {
    if (!appId || !file)
        return;
    try {
        const contents = await readFileBytes(file);
        if (!contents || contents.length === 0)
            return;
        const path = await writeCachedIcon(appId, contents);
        if (!path)
            return;
        const existing = getAppConfigValue(settings, appId, 'cached_icon_path');
        if (existing !== path)
            setAppConfigValue(settings, appId, 'cached_icon_path', path);
    } catch { /* cache snapshot is best-effort */ }
}

// SNI pixmaps arrive as ARGB in whatever array flavor the bindings picked.
function _pixmapBytes(rawData) {
    if (rawData instanceof Uint8Array)
        return rawData;
    if (rawData instanceof GLib.Bytes)
        return rawData.toArray();
    if (Array.isArray(rawData))
        return new Uint8Array(rawData);
    return null;
}

// FNV-1a, cheap enough to run on every frame.
function _hashPixmap(width, height, src) {
    let h = 0x811c9dc5;
    h = Math.imul(h ^ width, 0x01000193);
    h = Math.imul(h ^ height, 0x01000193);
    for (let i = 0; i < src.length; i++)
        h = Math.imul(h ^ src[i], 0x01000193);
    return h >>> 0;
}

function _pixmapToPng(width, height, src) {
    if (!width || !height || !src)
        return null;

    try {
        const expectedLen = width * height * 4;
        if (src.length < expectedLen)
            return null;

        const dest = new Uint8Array(expectedLen);
        for (let j = 0; j < expectedLen; j += 4) {
            const a = src[j];
            dest[j]     = src[j + 1];
            dest[j + 1] = src[j + 2];
            dest[j + 2] = src[j + 3];
            dest[j + 3] = a;
        }

        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            GLib.Bytes.new(dest),
            GdkPixbuf.Colorspace.RGB,
            true,
            8,
            width,
            height,
            width * 4
        );
        if (!pixbuf)
            return null;

        const [success, pngBuffer] = pixbuf.save_to_bufferv('png', [], []);
        if (!success || !pngBuffer || pngBuffer.length === 0)
            return null;
        return pngBuffer;
    } catch {
        /* malformed pixmap */ return null;
    }
}
