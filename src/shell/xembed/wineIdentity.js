import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {readDirNames, readFileText, readProcFile, readEnviron, isCancelledError} from '../../shared/asyncIo.js';
import {APP_ID_EXE_SUFFIX_RE, joinSplitId, sanitizeAppId} from '../identity/appId.js';
import {WINE_LAUNCHER_BINARIES} from '../identity/processIdentity.js';

const STEAM_APP_WMCLASS_RE = /^steam_app_/i;

// Window classes that name the Wine build instead of the app. One explorer
// process owns every XEmbed tray window in a prefix, so it shares one class.
const PLACEHOLDER_WMCLASS_RE = /^(steam_app_.*|steam_proton|explorer(\.exe)?)$/i;

const DEFAULT_WINE_PREFIX_ID = 'wine-default';

const GENERIC_UMU_GAME_IDS = new Set(['umu-default', 'default', '0']);

// Per-app env vars launchers stamp on their games, inherited by the
// prefix's explorer.exe. Faugus sets FAUGUSID, Heroic HEROIC_APP_NAME,
// Lutris GAME_NAME. Ordered by how specific they are.
const WINE_LAUNCHER_ENV_KEYS = Object.freeze(['FAUGUSID', 'HEROIC_APP_NAME', 'GAME_NAME']);

const PROC_WALK_MAX_DEPTH = 5;

export async function deriveAppMeta(rawIcon, cancellable) {
    const wmClass = safeProp(rawIcon, 'wm_class');
    const cleanWmClass = wmClass.replace(APP_ID_EXE_SUFFIX_RE, '');
    const xTitle = safeProp(rawIcon, 'title');
    const identity = await gatherWineIdentity(rawIcon, cancellable);

    const isSteamWmClass = STEAM_APP_WMCLASS_RE.test(wmClass);
    const isPlaceholderWmClass = PLACEHOLDER_WMCLASS_RE.test(wmClass);
    const looksLikeExe = APP_ID_EXE_SUFFIX_RE.test(wmClass);
    const isWine = identity.isWine || looksLikeExe;
    const isProton = identity.isProton || isSteamWmClass;

    // A plain-shell wine tree exports no wine variable at all, so an empty
    // walk still means the default prefix.
    if (isWine && !identity.prefixId && !identity.steamAppId)
        identity.prefixId = DEFAULT_WINE_PREFIX_ID;

    // wm_class beats the title because it survives restarts, but a
    // placeholder class loses to the launcher or prefix name.
    let candidate;
    if (identity.steamAppId)
        candidate = `steam-app-${identity.steamAppId}`;
    else if (identity.prefixId && (isPlaceholderWmClass || !cleanWmClass))
        candidate = joinSplitId(identity.prefixId, xTitle);
    else
        candidate = cleanWmClass || xTitle;

    const wmName = isPlaceholderWmClass ? '' : cleanWmClass;
    const title = await steamAppNameFromManifest(identity.steamAppId, cancellable) ||
        wmName || identity.launcherName || xTitle || identity.prefixId || cleanWmClass;

    const appId = sanitizeAppId(candidate);
    return {appId, isWine, isProton, title};
}

// Environ is inherited across fork(), so the parent chain reaches the Proton
// launcher even when a wineserver helper registered the icon.
async function gatherWineIdentity(rawIcon, cancellable) {
    const identity = newIdentity();

    let pid = rawIcon.pid;
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
        await adoptNamespacedIdentity(identity, rawIcon.pid, cancellable);

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

let _nsPidScan = null;

function hostPidsForNsPid(nsPid) {
    _nsPidScan ??= buildNsPidMap().finally(() => (_nsPidScan = null));
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

// Proton sets STEAM_COMPAT_DATA_PATH on every wine/wineserver process, while
// SteamGameId is 0 for non-Steam shortcuts.
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

function launcherNameFromEnviron(env) {
    for (const key of WINE_LAUNCHER_ENV_KEYS) {
        const value = env.get(key)?.trim();
        // Purely numeric values are store ids (GOG via Heroic), the prefix
        // directory name makes the better title there.
        if (value && !/^\d+$/.test(value))
            return value;
    }
    return null;
}

async function exeBaseFromCmdline(pid, cancellable) {
    const raw = await readProcFile(pid, 'cmdline', cancellable);
    const first = raw?.split('\0')[0];
    return first ? first.split('/').pop().toLowerCase() : null;
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
function safeProp(obj, prop) {
    try {
        return (obj[prop] ?? '').toString().trim();
    } catch {
        return '';
    }
}

export function clearIdentityCaches() {
    _manifestNameCache.clear();
    _nsPidScan = null;
}
