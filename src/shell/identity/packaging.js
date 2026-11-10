import GLib from 'gi://GLib';

import {fileExists, readProcFile} from '../../shared/asyncIo.js';

const APPIMAGE_VERSION_TOKEN_RE = /^v?\d/;

const APPIMAGE_NOISE_TOKEN_RE =
    /^(x86|x64|amd64|arm64|aarch64|i[0-9]86|linux|win32|win64|mac|beta|alpha|rc\d+|nightly|latest)$/i;

// Interpreter and runtime binaries name the runtime, so two Python tray apps
// would collide on one id.
export const GENERIC_PROCESS_NAME_RE =
    /^(python[\d.]*|node(js)?|electron[\d.]*|gjs|java|mono|ruby|perl|php|lua[\d.]*|(ba|z|da)?sh)$/i;

// systemd names a snap's scope after the snap and a flatpak's after the app id.
// The cgroup still reads when an app denies /proc/<pid>/exe, environ and root,
// KeePassXC does, so it goes ahead of the binary path and the sandbox manifest.
const SNAP_CGROUP_RE = /\/snap\.([^./]+)\./;

const FLATPAK_CGROUP_RE = /\/app-flatpak-(.+)-\d+\.scope/;

const FLATPAK_INFO_NAME_RE = /^name=(.+)$/m;

// A flatpak sees its own deployment at /app. On the host that tree sits in
// the per-user or the system installation, whichever holds the app.
const FLATPAK_APP_MOUNT = '/app/';
const FLATPAK_INSTALLATIONS = [`${GLib.get_user_data_dir()}/flatpak`, '/var/lib/flatpak'];

// Launchers start an app in a scope named after its desktop id and its first
// pid, and every helper process the app spawns stays in that scope.
const APP_SCOPE_RE = /\/app-(?:gnome-|flatpak-)?(.+)-(\d+)\.scope$/m;

// The session id is the fourth field after the command name in /proc/<pid>/stat
const STAT_SESSION_FIELD = 3;

// systemd escapes anything outside [A-Za-z0-9:_.] in a unit name, so an app id
// carrying a dash arrives as \x2d.
const SYSTEMD_UNIT_ESCAPE_RE = /\\x([0-9a-f]{2})/gi;

const APPIMAGE_PATH_RE = /\.appimage$/i;

// AppRun execs the payload out of the runtime's own mountpoint, so the process
// that registers the tray item reports a path in there instead of the .AppImage.
const APPIMAGE_MOUNT_PATH_RE = /\/\.mount_[^/]+\//;

// The same program installed natively and as a flatpak reports the same Id, so
// one config entry served both and hiding one hid the other. Native returns
// null, so an existing install keeps its key.
export async function resolvePackaging({pid, binaryPath = null, appImageName = null}) {
    if (appImageName)
        return {kind: 'appimage', id: appImageName};

    const cgroup = await readProcFile(pid, 'cgroup');

    const snap = cgroup?.match(SNAP_CGROUP_RE);
    if (snap)
        return {kind: 'snap', id: snap[1]};

    const flatpak = cgroup?.match(FLATPAK_CGROUP_RE);
    if (flatpak)
        return {kind: 'flatpak', id: _unescapeUnitName(flatpak[1])};

    const appImage = _appImageIdFromPath(binaryPath);
    if (appImage)
        return {kind: 'appimage', id: appImage};

    // A flatpak launched outside a systemd scope leaves the cgroup looking
    // native, and its sandbox manifest still names it.
    const sandboxed = await _flatpakIdFromSandbox(pid);
    return sandboxed ? {kind: 'flatpak', id: sandboxed} : null;
}

// Apps like Dropbox name an IconThemePath under /app, a folder only their
// sandbox has
export async function findHostPath(path, packaging) {
    if (packaging?.kind !== 'flatpak' || !path?.startsWith(FLATPAK_APP_MOUNT))
        return null;
    const inApp = path.slice(FLATPAK_APP_MOUNT.length);
    const candidates = FLATPAK_INSTALLATIONS.map(root =>
        `${root}/app/${packaging.id}/current/active/files/${inApp}`);
    const found = await Promise.all(candidates.map(candidate => fileExists(candidate)));
    return candidates[found.indexOf(true)] ?? null;
}

export async function scopeDesktopId(pid) {
    const cgroup = await readProcFile(pid, 'cgroup');
    const scope = cgroup?.match(APP_SCOPE_RE);
    if (!scope)
        return null;
    if (await _isStartedFromTerminalIn(pid, Number(scope[2]), cgroup))
        return null;
    return `${_unescapeUnitName(scope[1])}.desktop`;
}

// A terminal built into an app, VS Code's for one, runs its shell in the app's
// scope as a session of its own. What that shell starts is not the app.
async function _isStartedFromTerminalIn(pid, scopePid, cgroup) {
    const stat = await readProcFile(pid, 'stat');
    const session = Number(stat?.slice(stat.lastIndexOf(')') + 2).split(' ')[STAT_SESSION_FIELD]);
    if (!session || session === pid || session === scopePid)
        return false;
    return await readProcFile(session, 'cgroup') === cgroup;
}

// The first token always stays, names like 4K-Video-Downloader start with a
// digit.
export function appImageStem(path) {
    const file = path.split('/').pop().replace(APPIMAGE_PATH_RE, '');
    const tokens = file.split(/[-_]/).filter(Boolean);
    const kept = tokens.slice(0, 1);
    for (const token of tokens.slice(1)) {
        if (APPIMAGE_VERSION_TOKEN_RE.test(token) || APPIMAGE_NOISE_TOKEN_RE.test(token))
            break;
        kept.push(token);
    }
    return kept.join('-') || null;
}

// An AppImage whose payload sets dumpable=0, as KeePassXC does, gives up
// nothing and stays keyed as native. Guessing from a sibling process would
// mislabel a real native instance next to it.
function _appImageIdFromPath(path) {
    if (!path)
        return null;
    if (APPIMAGE_PATH_RE.test(path))
        return appImageStem(path);
    if (!APPIMAGE_MOUNT_PATH_RE.test(path))
        return null;

    const payload = path.split('/').pop();
    return payload && !GENERIC_PROCESS_NAME_RE.test(payload) ? payload : null;
}

async function _flatpakIdFromSandbox(pid) {
    const info = await readProcFile(pid, 'root/.flatpak-info');
    return info?.match(FLATPAK_INFO_NAME_RE)?.[1].trim() || null;
}

function _unescapeUnitName(name) {
    return name.replace(SYSTEMD_UNIT_ESCAPE_RE,
        (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
