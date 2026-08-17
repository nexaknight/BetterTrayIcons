import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readDirNames, readFileText, readProcFile, readEnviron, isCancelledError} from '../../shared/fetch.js';
import {APP_ID_EXE_SUFFIX_RE, sanitizeAppId} from '../utils/appId.js';
import {WINE_LAUNCHER_BINARIES} from '../utils/dbus.js';

// wm_class Wine assigns under Steam and umu, used as the Proton indicator.
// A real appid suffix only repeats what the env walk already yields, and
// umu stamps the same placeholder on every app, so steam_app_* never
// identifies an app.
const STEAM_APP_WMCLASS_RE = /^steam_app_/i;

// Window classes that name the Wine build instead of the app, never usable
// as app id, the launcher or prefix name wins over them. explorer.exe is
// here because one explorer process owns every XEmbed tray window in a prefix.
const PLACEHOLDER_WMCLASS_RE = /^(steam_app_.*|steam_proton|explorer(\.exe)?)$/i;

// ~/.wine has no app name of its own, but every app in it still needs an
// identity that isn't the shared placeholder wm_class.
const DEFAULT_WINE_PREFIX_ID = 'wine-default';

// Placeholder game-id values that identify no game. 'umu-default' is umu's
// documented fallback, '0' is the SteamGameId Steam stamps on non-Steam
// shortcuts.
const GENERIC_UMU_GAME_IDS = new Set(['umu-default', 'default', '0']);

// Per-app env vars launchers stamp on their games, inherited by the
// prefix's explorer.exe. Faugus sets FAUGUSID, Heroic HEROIC_APP_NAME,
// Lutris GAME_NAME. Ordered by how specific they are.
const WINE_LAUNCHER_ENV_KEYS = Object.freeze(['FAUGUSID', 'HEROIC_APP_NAME', 'GAME_NAME']);

const PROC_WALK_MAX_DEPTH = 5;

export async function deriveAppMeta(rawIcon, cancellable) {
    const wmClass = _safeProp(rawIcon, 'wm_class');
    const cleanWmClass = wmClass.replace(APP_ID_EXE_SUFFIX_RE, '');
    const xTitle = _safeProp(rawIcon, 'title');
    const id = await gatherWineIdentity(rawIcon, cancellable);

    const wmGeneric = STEAM_APP_WMCLASS_RE.test(wmClass);
    const wmPlaceholder = PLACEHOLDER_WMCLASS_RE.test(wmClass);
    const looksLikeExe = APP_ID_EXE_SUFFIX_RE.test(wmClass);
    const isWine = id.isWine || looksLikeExe;
    const isProton = id.isProton || wmGeneric;

    // No wine variable anywhere in the visible ancestry means Wine ran on its
    // documented default prefix (measured: a plain-shell wine tree exports
    // none of them). Without this every such app falls through to the shared
    // placeholder class and they all collapse onto one entry.
    if (isWine && !id.prefixId && !id.steamAppId)
        id.prefixId = DEFAULT_WINE_PREFIX_ID;

    // Identifier preference: Steam appid > launcher/prefix name > wm_class >
    // X11 title. wm_class beats X11 title because it stays stable across
    // restarts, but a placeholder class naming the Wine build instead of the
    // app loses to the launcher or prefix name.
    let candidate;
    if (id.steamAppId)
        candidate = `steam-app-${id.steamAppId}`;
    // Every app in one prefix shows the same placeholder class, so the prefix
    // alone would hand them all a single shared config entry.
    else if (id.prefixId && (wmPlaceholder || !cleanWmClass))
        candidate = _scopeToPrefix(id.prefixId, xTitle);
    else
        candidate = cleanWmClass || xTitle;

    const wmName = wmPlaceholder ? '' : cleanWmClass;
    const title = await steamAppNameFromManifest(id.steamAppId, cancellable) ||
        wmName || id.launcherName || xTitle || id.prefixId || cleanWmClass;

    // No appId means nothing identified this window. A pid-based one would
    // change on every launch and leave a dead config entry behind each time,
    // so the icon renders but stays session-volatile.
    const appId = sanitizeAppId(candidate);
    return {appId, isWine, isProton, steamAppId: id.steamAppId, title};
}

// Environ is inherited across fork(), so walking up the parent chain reaches
// the Proton launcher even when the tray icon was registered by a wineserver
// helper several levels deep.
async function gatherWineIdentity(rawIcon, cancellable) {
    const identity = newIdentity();

    let pid = rawIcon.pid || 0;
    /* eslint-disable no-await-in-loop */
    for (let depth = 0; depth < PROC_WALK_MAX_DEPTH && pid && pid !== 1; depth++) {
        mergeEnvIdentity(identity, await readEnviron(pid, cancellable));

        const exeBase = await exeBaseFromCmdline(pid, cancellable);
        if (exeBase && WINE_LAUNCHER_BINARIES.has(exeBase))
            identity.isWine = true;

        if (identity.steamAppId || identity.prefixId)
            break;
        pid = await readPpid(pid, cancellable);
    }
    /* eslint-enable no-await-in-loop */

    // Pressure-vessel runs Wine in its own pid namespace, so the pid X11
    // reports doesn't exist on the host and the walk above sees nothing.
    if (!identity.isWine && !identity.steamAppId && !identity.prefixId)
        await adoptNamespacedIdentity(identity, rawIcon.pid || 0, cancellable);

    return identity;
}

function newIdentity() {
    return {isWine: false, isProton: false, steamAppId: null, prefixId: null, launcherName: null};
}

function mergeEnvIdentity(identity, env) {
    if (!env.size)
        return;
    if (env.has('STEAM_COMPAT_DATA_PATH') ||
        env.has('PROTON_LOG') ||
        env.has('STEAM_COMPAT_CLIENT_INSTALL_PATH')) {
        identity.isProton = true;
        identity.isWine = true;
    }
    if (env.has('WINEPREFIX') || env.has('WINELOADER') || env.has('WINESERVER'))
        identity.isWine = true;
    identity.steamAppId ??= steamAppIdFromEnviron(env);
    identity.launcherName ??= launcherNameFromEnviron(env);
    identity.prefixId ??= prefixIdFromEnviron(env);
}

// Two containers can hand out the same namespaced pid, so the identity is
// only adopted when all Wine matches agree on one app.
async function adoptNamespacedIdentity(identity, nsPid, cancellable) {
    if (!nsPid)
        return;

    const hostPids = await hostPidsForNsPid(nsPid);
    const envs = await Promise.all(hostPids.map(pid => readEnviron(pid, cancellable)));

    const probes = [];
    for (const env of envs) {
        const probe = newIdentity();
        mergeEnvIdentity(probe, env);
        if (probe.isWine)
            probes.push(probe);
    }

    // The flags survive an ambiguous match, every candidate is a Wine
    // process, so the icon is one too. Only the app identity needs to
    // be unique.
    for (const probe of probes) {
        identity.isWine ||= probe.isWine;
        identity.isProton ||= probe.isProton;
    }

    const ids = new Set(probes.map(p => p.steamAppId ?? p.prefixId).filter(Boolean));
    if (ids.size > 1)
        return;

    for (const probe of probes) {
        identity.steamAppId ??= probe.steamAppId;
        identity.prefixId ??= probe.prefixId;
        identity.launcherName ??= probe.launcherName;
    }
}

// Icons usually appear in a burst on enable, one /proc sweep serves them
// all. Pids go stale quickly, so the result never outlives the sweep.
let _nsPidScan = null;

function hostPidsForNsPid(nsPid) {
    _nsPidScan ??= buildNsPidMap().finally(() => (_nsPidScan = null));
    // A failed sweep degrades to "no identity" like every other proc read.
    // Left to propagate, the rejection would take down the whole wrapper.
    return _nsPidScan.then(map => map.get(nsPid) ?? [], () => []);
}

// The last NSpid column is the pid inside the innermost namespace, which
// is what a sandboxed X11 client writes into _NET_WM_PID.
async function buildNsPidMap() {
    const names = await readDirNames(Gio.File.new_for_path('/proc'));
    const pids = names.filter(name => /^\d+$/.test(name));

    const map = new Map();
    await Promise.all(pids.map(async name => {
        const raw = await readProcFile(parseInt(name, 10), 'status', null);
        const fields = raw?.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/);
        if (!fields || fields.length < 2)
            return;
        const inner = parseInt(fields[fields.length - 1], 10);
        const bucket = map.get(inner) ?? [];
        bucket.push(parseInt(name, 10));
        map.set(inner, bucket);
    }));
    return map;
}


// STEAM_COMPAT_DATA_PATH is set by Proton on every wine/wineserver process.
// Better than SteamGameId (0 for non-Steam shortcuts) or the generic
// "steam_app_<id>" wm_class.
function steamAppIdFromEnviron(env) {
    const compatMatch = env.get('STEAM_COMPAT_DATA_PATH')?.match(/\/compatdata\/(\d+)/);
    if (compatMatch && compatMatch[1] !== '0')
        return compatMatch[1];
    for (const key of ['SteamGameId', 'SteamAppId', 'STEAM_APPID']) {
        const v = env.get(key);
        if (v && v !== '0' && /^\d+$/.test(v))
            return v;
    }
    return null;
}

// Wine launchers keep each prefix in its own named directory, so the name
// is still a solid identity when nothing better exists. Numeric names
// are compatdata layouts and belong to steamAppIdFromEnviron.
function prefixIdFromEnviron(env) {
    const launcherName = launcherNameFromEnviron(env);
    if (launcherName)
        return sanitizeAppId(launcherName);

    const gameId = env.get('UMU_ID') || env.get('GAMEID');
    if (gameId && !GENERIC_UMU_GAME_IDS.has(gameId.toLowerCase()))
        return sanitizeAppId(gameId);

    const root = env.get('STEAM_COMPAT_DATA_PATH') || env.get('WINEPREFIX');
    if (!root)
        return null;

    // Proton prefixes end in /pfx, the parent directory carries the name.
    const parts = root.split('/').filter(Boolean);
    if (parts[parts.length - 1] === 'pfx')
        parts.pop();

    const name = parts[parts.length - 1] ?? '';
    if (name === '.wine')
        return DEFAULT_WINE_PREFIX_ID;
    if (!name || /^\d+$/.test(name))
        return null;
    return sanitizeAppId(name);
}

// Not sanitized, the raw value doubles as the display title.
function launcherNameFromEnviron(env) {
    for (const key of WINE_LAUNCHER_ENV_KEYS) {
        const value = env.get(key)?.trim();
        // Purely numeric values are store ids (GOG via Heroic), the
        // prefix directory name makes the better title and id there.
        if (value && !/^\d+$/.test(value))
            return value;
    }
    return null;
}

async function exeBaseFromCmdline(pid, cancellable) {
    const raw = await readProcFile(pid, 'cmdline', cancellable);
    const first = raw?.split('\0')[0];
    return first ? (first.split('/').pop() || '').toLowerCase() : null;
}

async function readPpid(pid, cancellable) {
    const raw = await readProcFile(pid, 'status', cancellable);
    const m = raw?.match(/^PPid:\s+(\d+)/m);
    return m ? parseInt(m[1], 10) : 0;
}

const _manifestNameCache = new Map();
async function steamAppNameFromManifest(appId, cancellable) {
    if (!appId)
        return null;
    if (_manifestNameCache.has(appId))
        return _manifestNameCache.get(appId);

    const home = GLib.get_home_dir();
    const candidates = [
        `${home}/.steam/root/steamapps/appmanifest_${appId}.acf`,
        `${home}/.steam/steam/steamapps/appmanifest_${appId}.acf`,
        `${home}/.local/share/Steam/steamapps/appmanifest_${appId}.acf`,
        `${home}/.var/app/com.valvesoftware.Steam/.steam/root/steamapps/appmanifest_${appId}.acf`,
        `${home}/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/appmanifest_${appId}.acf`,
    ];
    /* eslint-disable no-await-in-loop */
    for (const path of candidates) {
        try {
            const text = await readFileText(Gio.File.new_for_path(path), cancellable);
            const m = text.match(/"name"\s+"([^"]+)"/);
            if (m) {
                _manifestNameCache.set(appId, m[1]);
                return m[1];
            }
        } catch (e) {
            if (isCancelledError(e))
                throw e;
        }
    }
    /* eslint-enable no-await-in-loop */
    _manifestNameCache.set(appId, null);
    return null;
}

// The read itself throws for non-UTF-8 bytes, so the property access has to
// sit inside the try, not its result.
function _safeProp(obj, prop) {
    try {
        return (obj[prop] ?? '').toString().trim();
    } catch {
        return '';
    }
}

function _scopeToPrefix(prefixId, xTitle) {
    const scope = sanitizeAppId(xTitle);
    return scope ? `${prefixId}@${scope}` : prefixId;
}

export function clearIdentityCaches() {
    _manifestNameCache.clear();
    _nsPidScan = null;
}
