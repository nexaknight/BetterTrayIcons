import {readProcFile} from '../../shared/asyncIo.js';

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
    return info?.match(FLATPAK_INFO_NAME_RE)?.[1]?.trim() || null;
}

function _unescapeUnitName(name) {
    return name.replace(SYSTEMD_UNIT_ESCAPE_RE,
        (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
