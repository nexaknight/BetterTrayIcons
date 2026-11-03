import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {fileExists, readDirNames} from '../shared/asyncIo.js';

export const GONE_ICON_NAME = 'bti-package-x-symbolic';

const DESKTOP_SUFFIX = '.desktop';
const FLATPAK_ID_PREFIX = 'flatpak-';
const SNAP_ID_PREFIX = 'snap-';
const SPLIT_ID_SEPARATOR = '@';
const DESKTOP_ID_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+){2,}$/;
const SNAP_BIN_DIR = '/snap/bin';
const FLATPAK_ROOTS = Object.freeze([
    GLib.build_filenamev([GLib.get_user_data_dir(), 'flatpak']),
    '/var/lib/flatpak',
]);

// Gone means not running and no install anchor left. Only Flatpak, Snap and
// reverse-DNS desktop ids name one, any other entry leaves no install trace and
// a false mark would read as an uninstall that never happened.
export async function probeGoneApps(apps, shownIcons) {
    const candidates = apps.filter(app => !shownIcons[app.id] && _hasAnchor(app));
    if (candidates.length === 0)
        return new Set();

    const [desktopIds, flatpakIds] = await Promise.all([
        _lowercaseNames(_desktopDirs()),
        _lowercaseNames(FLATPAK_ROOTS.flatMap(root => [
            GLib.build_filenamev([root, 'exports', 'share', 'applications']),
            GLib.build_filenamev([root, 'app']),
        ])),
    ]);
    const installed = {desktopIds, flatpakIds};
    const gone = await Promise.all(candidates.map(app => _isGone(app, installed)));
    return new Set(candidates.filter((_app, i) => gone[i]).map(app => app.id));
}

function _hasAnchor(app) {
    if (app.is_wine || app.is_proton || app.is_foreign)
        return false;
    return app.packaging === 'flatpak' || app.packaging === 'snap' ||
        (!app.packaging && DESKTOP_ID_RE.test(_baseId(app)));
}

function _baseId(app) {
    return app.id.split(SPLIT_ID_SEPARATOR)[0];
}

function _desktopDirs() {
    return [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]
        .map(dir => GLib.build_filenamev([dir, 'applications']));
}

// App ids are stored lowercased, so installed names compare lowercased too
async function _lowercaseNames(dirs) {
    const lists = await Promise.all(dirs.map(dir =>
        readDirNames(Gio.File.new_for_path(dir)).catch(() => [])));
    return new Set(lists.flat().map(name => {
        const lower = name.toLowerCase();
        return lower.endsWith(DESKTOP_SUFFIX) ? lower.slice(0, -DESKTOP_SUFFIX.length) : lower;
    }));
}

async function _isGone(app, {desktopIds, flatpakIds}) {
    const base = _baseId(app);
    if (app.packaging === 'flatpak')
        return !flatpakIds.has(base.slice(FLATPAK_ID_PREFIX.length));
    if (app.packaging === 'snap') {
        const name = base.slice(SNAP_ID_PREFIX.length);
        const hasDesktop = [...desktopIds].some(id => id.startsWith(`${name}_`));
        return !hasDesktop && !await fileExists(GLib.build_filenamev([SNAP_BIN_DIR, name]));
    }
    return !desktopIds.has(base);
}
