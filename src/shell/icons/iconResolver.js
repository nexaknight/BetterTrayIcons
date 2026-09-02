import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import St from 'gi://St';
import Shell from 'gi://Shell';

import {resolveIcon, findIconInThemeAsync, buildSymbolicCandidates, orderThemedNames, writeCachedIcon, deleteCachedIcon, tintedSymbolicIcon, symbolicTint, clearTintCache, MONO_ASSET_SUFFIX_RE} from '../../shared/iconLoading.js';
import {updateAppConfig, migrateLegacyConfig, claimAppId, getAppConfigMap, getAppConfigValue, setAppConfigValue, findStateIconEntry, recordSeenStateIcons, isVolatileIconName, stateNameOf, unreadBadgeEnabled, ATTENTION_STATE_KEY} from '../../shared/appConfig.js';
import {readFileBytes, fileExists} from '../../shared/asyncIo.js';
import {warnOnce} from '../../shared/logging.js';
import {getItemAddress, refreshPropertyOnProxy, refreshStringOnProxy} from '../dbusCalls.js';
import {getProcessInfo} from '../identity/processIdentity.js';
import {unreadBadge, unreadTargets} from '../features/launcherEntries.js';
import {sessionUsesLightStyle} from '../trayStyle.js';
import {stageScaleFactor} from '../actorPlacement.js';
import {pickAppId, pickDisplayTitle, legacyAppId, sanitizeAppId} from '../identity/appId.js';
import {resolveItemId} from '../identity/itemSplit.js';

const ICON_CACHE_SNAPSHOT_MS = 2000;
const ICON_CACHE_SNAPSHOT_US = ICON_CACHE_SNAPSHOT_MS * 1000;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// The SNI spec bounds no pixmap size, and hashing plus PNG encoding run on
// the compositor loop. 128 is the largest icon-size, 256 device pixels at scale 2.
const MAX_PIXMAP_SIZE_PX = 512;

export async function identifyApp(proxy, busName, settings, onRekey) {
    const [rawId, title, iconName, iconThemePath, processInfo, status] = await Promise.all([
        refreshStringOnProxy(proxy, 'Id'),
        refreshStringOnProxy(proxy, 'Title'),
        refreshStringOnProxy(proxy, 'IconName'),
        refreshStringOnProxy(proxy, 'IconThemePath'),
        getProcessInfo(proxy, busName),
        refreshStringOnProxy(proxy, 'Status'),
    ]);
    const processName = processInfo?.name;
    const isWine = !!processInfo?.isWine;
    const packaging = processInfo?.packaging;

    const identity = {processName, rawId, pid: processInfo?.pid, iconThemePath, iconName, title, packaging};
    const base = pickAppId(identity);

    const displayTitle = pickDisplayTitle({title, processName, appId: base, busName});

    if (!base)
        return {appId: null};

    const objectPath = proxy.get_object_path();
    const appId = resolveItemId(settings, {
        key: getItemAddress(busName, objectPath),
        pid: processInfo?.pid,
        base,
        splittable: base === sanitizeAppId(processName),
        discriminator: rawId ?? objectPath.split('/').pop(),
        rekey: onRekey,
    });

    // Claim before migrating, or an app identified earlier carries this id
    // away as its legacy key.
    claimAppId(appId);
    // A contained build copies instead of moving, its source key belongs to
    // the native build and that one may still register later.
    migrateLegacyConfig(settings,
        legacyAppId({...identity, legacyName: processInfo?.legacyName, busName}),
        appId, {copy: !!packaging});

    const seed = {title: displayTitle};

    // Never seed the baseline from an attention-state icon, it would invert
    // hasAlert. Volatile counter names identify no state and churn the blob.
    if (status !== 'NeedsAttention' && iconName && !isVolatileIconName(iconName))
        seed.detected_icon = iconName;
    if (iconThemePath)
        seed.icon_theme_path = iconThemePath;

    if (isWine)
        seed.is_wine = true;
    if (packaging)
        seed.packaging = packaging.kind;
    updateAppConfig(settings, appId, seed);

    return {appId, seed, processName, pid: processInfo?.pid};
}

export async function resolveTrayIcon(proxy, settings, appId, lastPixmapHash = null, pid = null, tint = null) {
    const [rawStatus, detectedName, overlayName] = await Promise.all([
        refreshStringOnProxy(proxy, 'Status'),
        refreshStringOnProxy(proxy, 'IconName'),
        refreshStringOnProxy(proxy, 'OverlayIconName'),
    ]);
    const status = rawStatus ?? 'Passive';

    const resolved = await _resolveIcon(proxy, settings, appId, lastPixmapHash, status, detectedName, pid, tint);
    return {..._applyOverlayEmblem(resolved, overlayName), status};
}

// The spec calls the overlay "extra state information" and the reference host
// renders it as an emblem, so a custom or mapped icon keeps it too.
function _applyOverlayEmblem(resolved, overlayName) {
    if (!overlayName || resolved.unchanged || resolved.iconName === 'image-missing')
        return resolved;
    const main = resolved.gicon ??
        (resolved.iconName ? new Gio.ThemedIcon({name: resolved.iconName}) : null);
    if (!main)
        return resolved;
    const emblemed = new Gio.EmblemedIcon({gicon: main});
    emblemed.add_emblem(new Gio.Emblem({icon: new Gio.ThemedIcon({name: overlayName})}));
    return {...resolved, gicon: emblemed, iconName: null};
}

async function _resolveIcon(proxy, settings, appId, lastPixmapHash, status, detectedName, pid, tint) {
    const generation = _generation;
    let attentionName = null;
    if (status === 'NeedsAttention')
        attentionName = await refreshStringOnProxy(proxy, 'AttentionIconName');

    const configMap = getAppConfigMap(settings);
    recordSeenStateIcons(settings, appId, [detectedName, attentionName], configMap);

    const customIcon = getAppConfigValue(settings, appId, 'custom_icon', null, configMap);

    // A live name that differs from the calm-state baseline means the app is
    // signaling something a pinned custom icon must not hide.
    const baseline = getAppConfigValue(settings, appId, 'detected_icon', null, configMap);
    const hasAlert = status === 'NeedsAttention' ||
        !!(detectedName && baseline && detectedName !== baseline &&
           !isVolatileIconName(detectedName));

    const detected = {iconName: detectedName, hasAlert, baselineMissing: !baseline};

    const isUnreadEnabled = unreadBadgeEnabled(configMap[appId]);
    const isCounterClass = status !== 'NeedsAttention' &&
        (!detectedName || isVolatileIconName(detectedName));
    let badge = null;
    let isAlertCovered = false;
    if (isUnreadEnabled) {
        badge = unreadBadge(unreadTargets({
            pid, appId,
            packagingKind: getAppConfigValue(settings, appId, 'packaging', null, configMap),
        }));
        if (!badge && status !== 'NeedsAttention') {
            if (hasAlert)
                badge = {text: null};
            else if (isCounterClass)
                badge = await _contentAlertBadge(proxy, settings, appId, detectedName);
        }
        isAlertCovered = badge !== null;
    } else if (isCounterClass) {
        await _rememberRestingContent(proxy, settings, appId, detectedName);
    }

    const stateIcons = customIcon
        ? getAppConfigValue(settings, appId, 'state_icons', null, configMap)
        : null;
    if (stateIcons) {
        let mapped = null;
        // Most apps keep IconName set while in attention, so the calm name's
        // mapping must not shadow the Attention row.
        if (status === 'NeedsAttention') {
            mapped = findStateIconEntry(stateIcons, stateNameOf(attentionName))?.[1] ??
                stateIcons[ATTENTION_STATE_KEY];
        }
        mapped ??= findStateIconEntry(stateIcons, stateNameOf(detectedName))?.[1];
        if (mapped)
            return {...await _configuredIconAsync(mapped, settings, tint), detected, badge};
    }

    if (customIcon && (!hasAlert || isAlertCovered))
        return {...await _configuredIconAsync(customIcon, settings, tint), detected, badge};

    // Qt serves showMessage's custom icon as an attention pixmap while the calm
    // IconName stays set, so the name has to yield or the cue never shows.
    const attentionPixmap = status === 'NeedsAttention' && !attentionName
        ? await refreshPropertyOnProxy(proxy, 'AttentionIconPixmap', {cache: false})
        : null;
    const iconName = attentionPixmap?.length ? null : attentionName || detectedName;
    // Apps also put relative paths here, not just names.
    const isThemeName = !!iconName && !iconName.includes('/');

    detected.iconThemePath = await refreshStringOnProxy(proxy, 'IconThemePath');
    const iconThemePath = detected.iconThemePath;

    // A -mono asset name hides a base the theme may carry, and a themed icon
    // beats the app's bundled file in both color modes.
    if (iconName && MONO_ASSET_SUFFIX_RE.test(iconName)) {
        const themed = _themedIconFromName(iconName, settings, true, appId, configMap);
        if (themed)
            return {...await _tintedThemed(themed, settings, tint), detected, badge};
    }

    const fileIconResult = async path => {
        const file = Gio.File.new_for_path(path);
        _snapshotIconToCache(settings, appId, file, generation).catch(() => {});
        const tinted = await _tinted(path, settings, tint);
        return {gicon: tinted ?? new Gio.FileIcon({file}), iconName: null, detected, badge};
    };

    const isAbsolutePath = !!iconName && iconName.startsWith('/');
    if (isAbsolutePath && await fileExists(iconName))
        return fileIconResult(iconName);

    const canSearchAppTheme = !!iconName && !isAbsolutePath && !!iconThemePath;
    if (canSearchAppTheme) {
        const resolvedPath = await findIconInThemeAsync(iconName, iconThemePath,
            {targetSize: _deviceIconSize(settings)});
        if (resolvedPath)
            return fileIconResult(resolvedPath);
    }

    if (isThemeName) {
        const themed = _themedIconFromName(iconName, settings, true, appId, configMap);
        if (themed)
            return {...await _tintedThemed(themed, settings, tint), detected, badge};
    }

    try {
        let pixmap = attentionPixmap;
        if (!pixmap?.length && status === 'NeedsAttention' && attentionName)
            pixmap = await refreshPropertyOnProxy(proxy, 'AttentionIconPixmap', {cache: false});
        if (!pixmap?.length)
            pixmap = await refreshPropertyOnProxy(proxy, 'IconPixmap', {cache: false});

        const usable = pixmap?.length ? pixmap.filter(_usablePixmapEntry) : [];
        if (usable.length > 0) {
            const targetSize = _deviceIconSize(settings);
            usable.sort((a, b) => Math.abs(a[0] - targetSize) - Math.abs(b[0] - targetSize));

            const [width, height, rawData] = usable[0];
            const src = _pixmapBytes(rawData);
            const pixmapHash = src ? _hashPixmap(width, height, src) : null;

            // Animated icons resend identical frames, a hash match skips swizzle,
            // PNG encode and cache write. Only while a cached copy exists, a
            // forgotten entry could never rebuild its prefs image otherwise.
            const hasCached = !!getAppConfigValue(settings, appId, 'cached_icon_path', null, configMap);
            if (pixmapHash !== null && pixmapHash === lastPixmapHash && hasCached)
                return {gicon: null, iconName: null, detected, pixmapHash, unchanged: true, badge};

            const pngBytes = src ? _pixmapToPng(width, height, src) : null;
            const canCacheSnapshot = !!pngBytes && !!appId;
            if (canCacheSnapshot) {
                await _throttledSnapshot(appId, generation,
                    () => _writePixmapCache(settings, appId, pngBytes, generation), {force: !hasCached});
            }
            if (pngBytes) {
                const gicon = Gio.BytesIcon.new(GLib.Bytes.new(pngBytes));
                return {gicon, iconName: null, detected, pixmapHash, badge};
            }
        }
    } catch (e) {
        warnOnce(`pixmap:${appId ?? pid}`, `Pixmap of '${appId ?? pid}' failed to render: ${e.message}`);
    }

    if (isThemeName) {
        const themed = _themedIconFromName(iconName, settings, false);
        if (themed)
            return {...themed, detected, badge};
    }

    const appIcon = _appIcon(pid);
    if (appIcon) {
        const file = appIcon.get_file?.();
        if (file)
            _snapshotIconToCache(settings, appId, file, generation).catch(() => {});
        return {gicon: appIcon, iconName: null, detected, badge};
    }

    warnOnce(`no-icon:${appId ?? pid}`,
        `Nothing renders for '${appId ?? pid}': IconName='${detectedName ?? ''}' IconThemePath='${iconThemePath ?? ''}', showing image-missing`);
    return {gicon: null, iconName: 'image-missing', detected, badge};
}

// Seeding takes whatever is on screen, so an app that boots into its unread
// image reads inverted until the resting state is redefined in the prefs.
async function _contentAlertBadge(proxy, settings, appId, detectedName) {
    const contentHash = await _liveIconContentHash(proxy, settings, detectedName);
    if (contentHash === null)
        return null;
    // Read fresh after the await, two resolves can overlap and one deciding on
    // a snapshot from before the other's seed would re-seed over it.
    const stored = getAppConfigValue(settings, appId, 'detected_icon_hash');
    const baseline = stored ?? _restingContentHash.get(appId) ?? contentHash;
    if (stored === null) {
        _restingContentHash.delete(appId);
        setAppConfigValue(settings, appId, 'detected_icon_hash', baseline);
    }
    return contentHash === baseline ? null : {text: null};
}

// Whatever the app showed when it first came up, kept per session so the blob
// stays untouched while the badge is off.
const _restingContentHash = new Map();

async function _rememberRestingContent(proxy, settings, appId, detectedName) {
    if (!appId || _restingContentHash.has(appId))
        return;
    const hash = await _liveIconContentHash(proxy, settings, detectedName);
    if (hash !== null)
        _restingContentHash.set(appId, hash);
}

async function _liveIconContentHash(proxy, settings, detectedName) {
    if (detectedName) {
        const path = detectedName.startsWith('/')
            ? detectedName
            : await _appThemeIconPath(proxy, settings, detectedName);
        if (!path || !await fileExists(path))
            return null;
        const bytes = await readFileBytes(Gio.File.new_for_path(path));
        return bytes.length ? _hashBytes(bytes) : null;
    }

    const pixmap = await refreshPropertyOnProxy(proxy, 'IconPixmap', {cache: false});
    const usable = (pixmap ?? []).find(_usablePixmapEntry);
    if (!usable)
        return null;
    const src = _pixmapBytes(usable[2]);
    return src ? _hashPixmap(usable[0], usable[1], src) : null;
}

async function _appThemeIconPath(proxy, settings, iconName) {
    const themePath = await refreshStringOnProxy(proxy, 'IconThemePath');
    if (!themePath)
        return null;
    return findIconInThemeAsync(iconName, themePath, {targetSize: _deviceIconSize(settings)});
}

// Only apps with a window are found here, a tray-only daemon is not.
function _appIcon(pid) {
    if (!pid)
        return null;
    return Shell.WindowTracker.get_default().get_app_from_pid(pid)?.get_icon();
}

function _deviceIconSize(settings) {
    return settings.get_int('icon-size') * stageScaleFactor();
}

// Constructing St.IconTheme per resolution re-reads the theme index.
let _sharedIconTheme = null;

function _themedIconFromName(iconName, settings, requireInTheme = true, appId = null, map = null) {
    const useSymbolic = settings.get_boolean('enable-symbolic-icons');
    const candidates = buildSymbolicCandidates(iconName, useSymbolic);
    if (candidates.length === 0)
        return null;

    let existing = null;
    let themeFile = null;
    _sharedIconTheme ??= new St.IconTheme();
    const size = _deviceIconSize(settings);
    // lookup_icon, not has_icon. St's has_icon only searches the theme index
    // and answers false for an unthemed icon in /usr/share/pixmaps, which
    // would then fall through to image-missing.
    for (const name of candidates) {
        const info = _sharedIconTheme.lookup_icon(name, size, 0);
        if (!info)
            continue;
        existing = name;
        themeFile = info.get_filename();
        break;
    }

    if (requireInTheme && !existing)
        return null;

    if (appId && existing)
        _dropCachedIcon(settings, appId, map);

    const names = orderThemedNames(candidates, existing, true);

    return {
        gicon: new Gio.ThemedIcon({names, use_default_fallbacks: true}),
        iconName: null,
        themeFile,
    };
}

// resolveIcon prefers a cached file over a theme name, and a snapshot would
// freeze the icon, symbolic art only recolors while the theme resolves it.
function _dropCachedIcon(settings, appId, map) {
    if (!getAppConfigValue(settings, appId, 'cached_icon_path', null, map))
        return;
    setAppConfigValue(settings, appId, 'cached_icon_path', null);
    deleteCachedIcon(appId);
}

async function _tintedThemed(themed, settings, tint) {
    const tinted = await _tinted(themed.themeFile, settings, tint);
    return {gicon: tinted ?? themed.gicon, iconName: null};
}

function _tinted(path, settings, tint) {
    return tintedSymbolicIcon(path, tint ?? symbolicTint(settings, {light: sessionUsesLightStyle()}),
        {size: _deviceIconSize(settings)});
}

async function _configuredIconAsync(value, settings, tint = null) {
    const exists = value.startsWith('/') ? await fileExists(value) : null;
    if (exists) {
        const gicon = await _tinted(value, settings, tint);
        if (gicon)
            return {gicon, iconName: null};
    }
    return configuredIcon(value, settings, exists);
}

export function configuredIcon(value, settings, exists = null) {
    const resolved = resolveIcon({custom_icon: value});

    if (resolved.type === 'file') {
        const file = Gio.File.new_for_path(resolved.value);
        // A FileIcon for a missing path paints nothing, the icon would vanish.
        if (exists ?? file.query_exists(null))
            return {gicon: new Gio.FileIcon({file}), iconName: null};
        warnOnce(`custom-icon:${resolved.value}`, `Custom icon '${resolved.value}' does not exist, showing image-missing`);
        return {gicon: null, iconName: 'image-missing'};
    }

    return themedIconContent(resolved.value, settings);
}

export function themedIconContent(iconName, settings) {
    return _themedIconFromName(iconName, settings, false);
}

// A resolve in flight when the extension is disabled runs to completion, so it
// has to notice and drop out rather than write to disk or arm a timer after.
let _generation = 0;

function _isStale(generation) {
    return generation !== _generation;
}

// Within a session two resolves for one app can overlap, and the slower one
// would put its older frame on top.
const _snapshotSeq = new Map();

// Some apps store their IconThemePath in an ephemeral directory, so copy the
// bytes into our own cache.
async function _snapshotIconToCache(settings, appId, file, generation) {
    if (!appId)
        return;
    const seq = (_snapshotSeq.get(appId) ?? 0) + 1;
    _snapshotSeq.set(appId, seq);
    await _throttledSnapshot(appId, generation,
        () => _writeIconSnapshot(settings, appId, file, generation, seq));
}

async function _throttledSnapshot(appId, generation, writeFn, {force = false} = {}) {
    if (force || _takeSnapshotSlot(appId)) {
        _cancelTrailingSnapshot(appId);
        await writeFn();
        return;
    }
    _scheduleTrailingSnapshot(appId, generation, () => writeFn().catch(() => {}));
}

// The cached copy only feeds the prefs page, the panel renders from memory, so
// disk writes don't have to follow every animation frame.
const _lastSnapshotAt = new Map();

function _takeSnapshotSlot(appId) {
    const now = GLib.get_monotonic_time();
    if (now - (_lastSnapshotAt.get(appId) ?? 0) < ICON_CACHE_SNAPSHOT_US)
        return false;
    _lastSnapshotAt.set(appId, now);
    return true;
}

// A change inside the throttle window would otherwise freeze the cache on
// the previous frame until the next icon change, which may never come.
const _pendingSnapshots = new Map();

function _scheduleTrailingSnapshot(appId, generation, write) {
    if (_isStale(generation))
        return;
    _cancelTrailingSnapshot(appId);
    _pendingSnapshots.set(appId, GLib.timeout_add(GLib.PRIORITY_DEFAULT, ICON_CACHE_SNAPSHOT_MS, () => {
        _pendingSnapshots.delete(appId);
        _lastSnapshotAt.set(appId, GLib.get_monotonic_time());
        write();
        return GLib.SOURCE_REMOVE;
    }));
}

function _cancelTrailingSnapshot(appId) {
    const id = _pendingSnapshots.get(appId);
    if (!id)
        return;
    GLib.source_remove(id);
    _pendingSnapshots.delete(appId);
}

async function _writeIconSnapshot(settings, appId, file, generation, seq) {
    const isOvertaken = () => _isStale(generation) || seq !== _snapshotSeq.get(appId);
    try {
        if (isOvertaken())
            return;
        const contents = await readFileBytes(file);
        if (contents.length === 0 || isOvertaken())
            return;
        const path = await writeCachedIcon(appId, contents);
        if (!path || isOvertaken())
            return;
        const existing = getAppConfigValue(settings, appId, 'cached_icon_path');
        if (existing !== path)
            setAppConfigValue(settings, appId, 'cached_icon_path', path);
    } catch (e) {
        warnOnce(`snapshot:${appId}`, `Icon cache write for '${appId}' failed: ${e.message}`);
    }
}

async function _writePixmapCache(settings, appId, pngBytes, generation) {
    if (_isStale(generation))
        return;
    const path = await writeCachedIcon(appId, pngBytes);
    if (path && !_isStale(generation))
        setAppConfigValue(settings, appId, 'cached_icon_path', path);
}

function _usablePixmapEntry(entry) {
    if (!entry || entry.length < 3)
        return false;
    const [w, h] = entry;
    return w > 0 && h > 0 && Math.max(w, h) <= MAX_PIXMAP_SIZE_PX;
}

// SNI pixmaps arrive as ARGB in whatever array flavor the bindings picked.
function _pixmapBytes(rawData) {
    if (rawData instanceof Uint8Array)
        return rawData;
    if (Array.isArray(rawData))
        return new Uint8Array(rawData);
    return null;
}

function _hashBytes(bytes, seed = FNV_OFFSET_BASIS, length = bytes.length) {
    let h = seed;
    for (let i = 0; i < length; i++)
        h = Math.imul(h ^ bytes[i], FNV_PRIME);
    return h >>> 0;
}

// MAX_PIXMAP_SIZE_PX bounds the declared width and height, not the array a
// peer attaches, so only the declared bytes count. Any bus client could
// otherwise stall the compositor with a 1x1 icon carrying a huge tail.
function _hashPixmap(width, height, src) {
    let seed = Math.imul(FNV_OFFSET_BASIS ^ width, FNV_PRIME);
    seed = Math.imul(seed ^ height, FNV_PRIME);
    return _hashBytes(src, seed, Math.min(src.length, width * height * 4));
}

function _pixmapToPng(width, height, src) {
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

        const [, pngBuffer] = pixbuf.save_to_bufferv('png', [], []);
        if (pngBuffer.length === 0)
            return null;
        return pngBuffer;
    } catch {
        return null;
    }
}

export function clearIconCaches() {
    _generation++;
    for (const id of _pendingSnapshots.values())
        GLib.source_remove(id);
    _pendingSnapshots.clear();
    _lastSnapshotAt.clear();
    _snapshotSeq.clear();
    _restingContentHash.clear();
    _sharedIconTheme = null;
    clearTintCache();
}
