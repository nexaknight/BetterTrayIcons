import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import St from 'gi://St';
import Shell from 'gi://Shell';

import {resolveIcon, findIconInThemeAsync, buildSymbolicCandidates, orderThemedNames, writeCachedIcon, deleteCachedIcon, tintedSymbolicIcon, symbolicTint, clearTintCache, MONO_ASSET_SUFFIX_RE} from '../../shared/icon.js';
import {updateAppConfig, migrateLegacyConfig, claimAppId, getAppConfigMap, getAppConfigValue, setAppConfigValue, findStateIconEntry, recordSeenStateIcons, isVolatileIconName, stateNameOf, unreadBadgeEnabled, ATTENTION_STATE_KEY} from '../../shared/appConfig.js';
import {readFileBytes, fileExists} from '../../shared/fetch.js';
import {warnOnce} from '../../shared/logging.js';
import {getItemAddress, refreshPropertyOnProxy, refreshStringOnProxy, getProcessInfo} from './dbus.js';
import {unreadBadge, unreadTargets} from './launcherEntries.js';
import {sessionUsesLightStyle, stageScaleFactor} from './actor.js';
import {pickAppId, pickDisplayTitle, legacyAppId, sanitizeAppId} from './appId.js';
import {resolveItemId} from './itemSplit.js';

const ICON_CACHE_SNAPSHOT_MS = 2000;

// Hashing, swizzling and PNG-encoding a pixmap all run on the compositor
// loop, and the cost grows with the area. Nothing in the SNI spec bounds
// the dimensions, so a client serving a 4096 square would stall the shell
// for roughly a quarter second on every icon update. The largest icon-size
// the prefs offer is 128, which needs 256 device pixels at scale 2.
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
        // Only a process-derived key can collide, an id taken from the item
        // itself already differs per item.
        splittable: base === sanitizeAppId(processName),
        discriminator: rawId ?? objectPath.split('/').pop(),
        rekey: onRekey,
    });

    // Claim before migrating, an app identified earlier must not be able to
    // carry this id away as its own legacy key.
    claimAppId(appId);
    // A contained build copies instead of moving, because the key it starts
    // from is the native build's and that one may register later in the session.
    migrateLegacyConfig(settings,
        legacyAppId({...identity, legacyName: processInfo?.legacyName, busName}),
        appId, {copy: !!packaging});

    const seed = {title: displayTitle};

    // Never seed the baseline from an attention-state icon, it would invert
    // hasAlert. The first calm frame sets detected_icon via trayIcon instead.
    // Volatile counter names identify no state and would churn the blob.
    if (status !== 'NeedsAttention' && iconName && !isVolatileIconName(iconName))
        seed.detected_icon = iconName;
    if (iconThemePath)
        seed.icon_theme_path = iconThemePath;

    // Persist is_wine so it survives the process exiting.
    if (isWine)
        seed.is_wine = true;
    // The prefs badge this, so a native and a flatpak build of one app are
    // told apart by the row rather than by a suffix on the name.
    if (packaging)
        seed.packaging = packaging.kind;
    updateAppConfig(settings, appId, seed);

    return {appId, seed, processName, pid: processInfo?.pid};
}

// Constructing St.IconTheme per resolution would re-read the theme index
// every time.
let _sharedIconTheme = null;

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

// The spec calls the overlay "extra state information", and the reference
// host renders it as an emblem on the main icon, so a custom or mapped icon
// keeps it too.
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

    // The baseline is the calm-state icon name. A different live name or an
    // attention status means the app is signaling something a pinned custom
    // icon must not hide. Volatile names change on every update and carry no
    // state, comparing them would suppress the custom icon forever.
    const baseline = getAppConfigValue(settings, appId, 'detected_icon', null, configMap);
    const hasAlert = status === 'NeedsAttention' ||
        !!(detectedName && baseline && detectedName !== baseline &&
           !isVolatileIconName(detectedName));

    // Every return carries this, the custom-icon ones included: without it
    // the caller could never seed the baseline for an app it renders a
    // custom icon for, and its name alerts would stay dead forever.
    const detected = {iconName: detectedName, hasAlert, baselineMissing: !baseline};

    // The count lives on the LauncherEntry channel, SNI itself has none.
    // Without a count a name alert degrades to a plain dot, and the badge
    // then IS the cue, so it keeps a custom icon in place where a bare
    // alert would push it aside.
    const unreadEnabled = unreadBadgeEnabled(configMap[appId]);
    // The counter class never trips the name alert: Chromium bumps a volatile
    // file per change and pixmaps carry no name at all, so the only readable
    // signal is the image content itself.
    const counterClass = status !== 'NeedsAttention' &&
        (!detectedName || isVolatileIconName(detectedName));
    let badge = null;
    let alertCovered = false;
    if (unreadEnabled) {
        badge = unreadBadge(unreadTargets({
            pid, appId,
            packagingKind: getAppConfigValue(settings, appId, 'packaging', null, configMap),
        }));
        if (!badge && status !== 'NeedsAttention') {
            if (hasAlert)
                badge = {text: null};
            else if (counterClass)
                badge = await _contentAlertBadge(proxy, settings, appId, detectedName);
        }
        alertCovered = badge !== null;
    } else if (counterClass) {
        await _rememberRestingContent(proxy, settings, appId, detectedName);
    }

    const stateIcons = customIcon
        ? getAppConfigValue(settings, appId, 'state_icons', null, configMap)
        : null;
    if (stateIcons) {
        let mapped = null;
        // Spec-typical apps keep IconName set while in attention, so a mapping
        // for the calm name must not shadow what the Attention row promises.
        if (status === 'NeedsAttention') {
            mapped = findStateIconEntry(stateIcons, stateNameOf(attentionName))?.[1] ??
                stateIcons[ATTENTION_STATE_KEY];
        }
        mapped ??= findStateIconEntry(stateIcons, stateNameOf(detectedName))?.[1];
        if (mapped)
            return {...await _configuredIconAsync(mapped, settings, tint), detected, badge};
    }

    if (customIcon && (!hasAlert || alertCovered))
        return {...await _configuredIconAsync(customIcon, settings, tint), detected, badge};

    // Qt serves showMessage's custom icon as an attention pixmap while the
    // calm IconName stays set. Nulling the name here sends every branch
    // below to the pixmap, otherwise the attention cue would never show.
    const attentionPixmap = status === 'NeedsAttention' && !attentionName
        ? await refreshPropertyOnProxy(proxy, 'AttentionIconPixmap', {cache: false})
        : null;
    const iconName = attentionPixmap?.length ? null : attentionName || detectedName;
    // Apps also put relative paths here, not just names. Any slash makes it a
    // path, and a theme lookup can never match one.
    const isThemeName = !!iconName && !iconName.includes('/');

    detected.iconThemePath = await refreshStringOnProxy(proxy, 'IconThemePath');
    const iconThemePath = detected.iconThemePath;

    // Asset names reveal a base the theme may cover, and a themed icon
    // beats the app's bundled fallback file in both color modes.
    if (iconName && MONO_ASSET_SUFFIX_RE.test(iconName)) {
        const themed = _themedIconFromName(iconName, settings, true, appId, configMap);
        if (themed)
            return {...await _tintedThemed(themed, settings, tint), detected, badge};
    }

    const fileIconResult = async path => {
        const file = Gio.File.new_for_path(path);
        _snapshotIconToCache(settings, appId, file, generation).catch(() => { /* best-effort */ });
        const tinted = await _tinted(path, settings, tint);
        return {gicon: tinted ?? new Gio.FileIcon({file}), iconName: null, detected, badge};
    };

    if (iconName) {
        if (iconName.startsWith('/')) {
            if (await fileExists(iconName))
                return fileIconResult(iconName);
        } else if (iconThemePath) {
            // findIconInThemeAsync only returns a path it has already proven.
            const resolvedPath = await findIconInThemeAsync(iconName, iconThemePath,
                {targetSize: _deviceIconSize(settings)});
            if (resolvedPath)
                return fileIconResult(resolvedPath);
        }
    }

    if (isThemeName) {
        const themed = _themedIconFromName(iconName, settings, true, appId, configMap);
        if (themed)
            return {...await _tintedThemed(themed, settings, tint), detected, badge};
    }

    // Cache the result to disk so the prefs Applications page renders the
    // same image.
    try {
        let pixmap = attentionPixmap;
        if (!pixmap?.length && status === 'NeedsAttention' && attentionName)
            pixmap = await refreshPropertyOnProxy(proxy, 'AttentionIconPixmap', {cache: false});
        if (!pixmap?.length)
            pixmap = await refreshPropertyOnProxy(proxy, 'IconPixmap', {cache: false});

        if (pixmap && pixmap.length > 0) {
            const targetSize = _deviceIconSize(settings);

            const usable = pixmap.filter(_usablePixmapEntry);
            usable.sort((a, b) => Math.abs(a[0] - targetSize) - Math.abs(b[0] - targetSize));

            const bestMatch = usable[0];
            if (bestMatch) {
                const [width, height, rawData] = bestMatch;
                const src = _pixmapBytes(rawData);
                const pixmapHash = src ? _hashPixmap(width, height, src) : null;

                // Animated icons often resend identical frames. Matching the
                // previous hash skips the swizzle, the PNG encode and the cache
                // write. Only valid while a cached copy exists, a forgotten
                // entry could otherwise never rebuild its prefs image.
                const hasCached = !!getAppConfigValue(settings, appId, 'cached_icon_path', null, configMap);
                if (pixmapHash !== null && pixmapHash === lastPixmapHash && hasCached)
                    return {gicon: null, iconName: null, detected, pixmapHash, unchanged: true, badge};

                const pngBytes = src ? _pixmapToPng(width, height, src) : null;
                if (pngBytes) {
                    if (appId) {
                        const write = async () => {
                            if (_stale(generation))
                                return;
                            const path = await writeCachedIcon(appId, pngBytes);
                            if (path && !_stale(generation))
                                setAppConfigValue(settings, appId, 'cached_icon_path', path);
                        };
                        await _throttledSnapshot(appId, generation, write, {force: !hasCached});
                    }
                    const gicon = Gio.BytesIcon.new(GLib.Bytes.new(pngBytes));
                    return {gicon, iconName: null, detected, pixmapHash, badge};
                }
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
            _snapshotIconToCache(settings, appId, file, generation).catch(() => { /* best-effort */ });
        return {gicon: appIcon, iconName: null, detected, badge};
    }

    warnOnce(`no-icon:${appId ?? pid}`,
        `Nothing renders for '${appId ?? pid}': IconName='${detectedName ?? ''}' IconThemePath='${iconThemePath ?? ''}', showing image-missing`);
    return {gicon: null, iconName: 'image-missing', detected, badge};
}

// A dot for apps whose unread cue only exists as different image bytes.
// Seeding takes whatever is on screen, so an app that boots straight into
// its unread image reads inverted until the resting state is redefined in
// the prefs.
async function _contentAlertBadge(proxy, settings, appId, detectedName) {
    const contentHash = await _liveIconContentHash(proxy, settings, detectedName);
    if (contentHash === null)
        return null;
    // Read fresh after the await: two resolves can overlap, and one deciding
    // on a snapshot from before the other's seed would re-seed over it.
    const stored = getAppConfigValue(settings, appId, 'detected_icon_hash');
    const baseline = stored ?? _restingContentHash.get(appId) ?? contentHash;
    if (stored === null) {
        // Read into baseline above and then dropped, otherwise redefining the
        // resting state in the prefs would only put this frame back.
        _restingContentHash.delete(appId);
        setAppConfigValue(settings, appId, 'detected_icon_hash', baseline);
    }
    return contentHash === baseline ? null : {text: null};
}

// Whatever the app showed when it first came up, kept per session so the
// blob stays untouched while the badge is off. Switching it on later has to
// reach back to that frame, a chat app sitting on unread would otherwise
// define its alert as the calm state.
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
        let path = null;
        if (detectedName.startsWith('/')) {
            path = detectedName;
        } else {
            const themePath = await refreshStringOnProxy(proxy, 'IconThemePath');
            if (themePath) {
                path = await findIconInThemeAsync(detectedName, themePath,
                    {targetSize: _deviceIconSize(settings)});
            }
        }
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

// An app can name an icon that resolves nowhere and ship no pixmap either,
// which leaves nothing to draw. Its desktop entry still names a real one.
// Only apps with a window are found, a tray-only daemon is not.
function _appIcon(pid) {
    if (!pid)
        return null;
    return Shell.WindowTracker.get_default().get_app_from_pid(pid)?.get_icon();
}

// The panel paints in device pixels, so at scale 2 a 22px variant would beat
// a 48px one on size distance and then get upscaled.
function _deviceIconSize(settings) {
    return settings.get_int('icon-size') * stageScaleFactor();
}

function _themedIconFromName(iconName, settings, requireInTheme = true, appId = null, map = null) {
    const useSymbolic = settings.get_boolean('enable-symbolic-icons');
    const candidates = buildSymbolicCandidates(iconName, useSymbolic);
    if (candidates.length === 0)
        return null;

    let existing = null;
    let themeFile = null;
    _sharedIconTheme ??= new St.IconTheme();
    // lookup_icon, not has_icon: St's has_icon only searches the theme index
    // and answers false for an unthemed icon in /usr/share/pixmaps, which
    // then loses to an image-missing tail. Gtk's has_icon does see those, so
    // this is what keeps the prefs and the panel on the same icon.
    const size = _deviceIconSize(settings);
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

// A theme name renders in prefs on its own, and resolveIcon prefers a cached
// file over the name. A snapshot of the theme file would freeze the icon:
// symbolic art only recolors when the theme resolves it, and a raster variant
// gets rescaled.
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

// The icon update runs on the shell's main loop, where a blocking stat stalls
// the whole desktop rather than one window.
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
    const res = resolveIcon({custom_icon: value});

    if (res.type === 'file') {
        const file = Gio.File.new_for_path(res.value);
        // A FileIcon for a missing path paints nothing at all, so the icon would
        // just vanish from the panel. Prefs show image-missing for the same
        // config, and both must agree.
        if (exists ?? file.query_exists(null))
            return {gicon: new Gio.FileIcon({file}), iconName: null};
        warnOnce(`custom-icon:${res.value}`, `Custom icon '${res.value}' does not exist, showing image-missing`);
        return {gicon: null, iconName: 'image-missing'};
    }

    // Same fallback chain as the prefs side so both render identically.
    return themedIconContent(res.value, settings);
}

// Named apart from the prefs-side themedIcon in shared/icon.js, which hands
// back a bare Gio.ThemedIcon. This one returns what setIconContent takes.
export function themedIconContent(iconName, settings) {
    return _themedIconFromName(iconName, settings, false);
}


// A resolve already in flight when the extension is disabled runs to completion
// on its own, so it has to notice and drop out rather than write to disk
// afterwards or arm a timer nothing is left to cancel.
let _generation = 0;

function _stale(generation) {
    return generation !== _generation;
}

// The cached copy only feeds the prefs page, the panel renders from
// memory, so disk writes don't have to follow every animation frame.
const _lastSnapshotAt = new Map();

function _shouldSnapshot(appId) {
    const now = GLib.get_monotonic_time();
    if (now - (_lastSnapshotAt.get(appId) ?? 0) < ICON_CACHE_SNAPSHOT_MS * 1000)
        return false;
    _lastSnapshotAt.set(appId, now);
    return true;
}

// A change inside the throttle window would otherwise freeze the cache on
// the previous frame until the next icon change, which may never come.
const _pendingSnapshots = new Map();

function _scheduleTrailingSnapshot(appId, generation, write) {
    if (_stale(generation))
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
    if (id) {
        GLib.source_remove(id);
        _pendingSnapshots.delete(appId);
    }
}

// The shell keeps modules loaded across disable/enable, so without this a
// trailing snapshot would still fire and write to disk seconds after the
// extension was disabled.
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

async function _throttledSnapshot(appId, generation, writeFn, {force = false} = {}) {
    if (force || _shouldSnapshot(appId)) {
        _cancelTrailingSnapshot(appId);
        await writeFn();
        return;
    }
    _scheduleTrailingSnapshot(appId, generation, () => writeFn().catch(() => { /* best-effort */ }));
}

// The epoch above only covers disable. Within a session two resolves for one
// app can overlap, and the slower one would put its older frame over the
// newer cache copy.
const _snapshotSeq = new Map();

// Some apps store their IconThemePath in an ephemeral directory, so copy
// the bytes into our cache.
async function _snapshotIconToCache(settings, appId, file, generation) {
    if (!appId)
        return;
    const seq = (_snapshotSeq.get(appId) ?? 0) + 1;
    _snapshotSeq.set(appId, seq);
    await _throttledSnapshot(appId, generation,
        () => _writeIconSnapshot(settings, appId, file, generation, seq));
}

async function _writeIconSnapshot(settings, appId, file, generation, seq) {
    const overtaken = () => _stale(generation) || seq !== _snapshotSeq.get(appId);
    try {
        if (overtaken())
            return;
        const contents = await readFileBytes(file);
        if (contents.length === 0 || overtaken())
            return;
        const path = await writeCachedIcon(appId, contents);
        if (!path || overtaken())
            return;
        const existing = getAppConfigValue(settings, appId, 'cached_icon_path');
        if (existing !== path)
            setAppConfigValue(settings, appId, 'cached_icon_path', path);
    } catch (e) {
        // The panel keeps rendering, only the prefs image goes stale.
        warnOnce(`snapshot:${appId}`, `Icon cache write for '${appId}' failed: ${e.message}`);
    }
}

// A peer chooses its own dimensions, nothing in the spec bounds them.
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

// FNV-1a, cheap enough to run on every frame.
function _hashBytes(bytes, seed = 0x811c9dc5, length = bytes.length) {
    let h = seed;
    for (let i = 0; i < length; i++)
        h = Math.imul(h ^ bytes[i], 0x01000193);
    return h >>> 0;
}

// Only over the bytes the declared size covers. MAX_PIXMAP_SIZE_PX bounds the
// width and height a peer reports, never the length of the array it attaches,
// so hashing src.length let any process on the session bus stall the compositor
// with a 1x1 icon carrying a multi-megabyte tail. The bytes past the declared
// size never reach the image either, _pixmapToPng stops at expectedLen.
function _hashPixmap(width, height, src) {
    let seed = Math.imul(0x811c9dc5 ^ width, 0x01000193);
    seed = Math.imul(seed ^ height, 0x01000193);
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
        /* malformed pixmap */ return null;
    }
}
