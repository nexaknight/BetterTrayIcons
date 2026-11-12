import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {readFileBytes} from '../shared/asyncIo.js';

const ICON_THEME_GROUP = 'Icon Theme';
const ICON_CACHE_FILE = 'icon-theme.cache';
const ICON_EXTENSIONS_RE = /\.(svg|png)$/;
const SIZE_SEGMENT_RE = /\/(\d+)(?:x\d+)?(?:@(\d+)x?)?\//;
const SCALABLE_SEGMENT = '/scalable/';
const SYMBOLIC_NAME_RE = /-symbolic(?:-rtl)?$/;
const SKIPPED_DIRS = new Set(['symbolic', 'cursors']);
const SCALABLE_SIZE = 1024;
const SVG_SCORE = 1e6;
const BITMAP_TARGET_PX = 48;
const BITMAP_TARGET_SCORE = 1e5;
const ENUMERATE_BATCH = 500;
const MAX_LINK_HOPS = 8;
const LINKED_DIR_DEPTH = 1;
const WALK_MAX_DEPTH = 3;
// The gtk-update-icon-cache layout, gtk/gtkiconcache.c and
// gtk/gtkiconcacheprivate.h in GTK. Offsets are big-endian from file start.
const CACHE_MAJOR = 1;
const CACHE_MINOR = 0;
const CACHE_CHAIN_END = 0xffffffff;
const CACHE_IMAGE_SIZE = 8;
const CACHE_BUCKETS_PER_TICK = 500;
const CACHE_FLAG_SVG = 1 << 1;
const CACHE_FLAG_PNG = 1 << 2;
const SYMBOLIC_PNG_SUFFIX = '.symbolic';

const WALK_ATTRIBUTES = 'standard::name,standard::type,standard::symlink-target,access::can-read';
// The best few sources per name, enough to step past a broken link.
const MAX_CANDIDATES = 3;

// The user's data dir comes first, an icon theme found there shadows the
// system copy of the same name.
const FLATPAK_ICON_ROOTS = Object.freeze([
    GLib.build_filenamev([GLib.get_user_data_dir(), 'flatpak', 'exports', 'share', 'icons']),
    '/var/lib/flatpak/exports/share/icons',
]);

let _packs = null;

// Only the index.theme of every pack, the active theme first. A pack's icons
// are read on their own, when its section is about to be listed.
export function listIconPacks() {
    _packs ??= _findPacks();
    _packs.catch(() => (_packs = null));
    return _packs;
}

// Read once per pack for the prefs process. A name, a folder index and a
// format flag per icon, the path is put together only when a cell needs it.
export function loadPackIcons(pack) {
    pack.icons ??= _scanPack(pack);
    pack.icons.catch(() => (pack.icons = null));
    return pack.icons;
}

export function packIconPath(pack, index) {
    const {names, folderIndex, isPng, folders} = pack;
    return `${folders[folderIndex[index]]}/${names[index]}${isPng[index] ? '.png' : '.svg'}`;
}

export function packIconIndex(pack, path) {
    const index = pack.names?.indexOf(GLib.path_get_basename(path).replace(ICON_EXTENSIONS_RE, '')) ?? -1;
    return index !== -1 && packIconPath(pack, index) === path ? index : -1;
}

export function isIconPackPath(path) {
    return typeof path === 'string' && _iconRoots().some(dir => path.startsWith(`${dir}/`));
}

// Reads only the index.theme of the pack a path sits in, no scan. Null for a
// file outside every icon folder or inside a hidden pack.
export async function packNameForPath(path) {
    const root = _iconRoots().find(dir => path.startsWith(`${dir}/`));
    const themeId = root ? path.slice(root.length + 1).split('/')[0] : null;
    if (!themeId)
        return null;
    const index = await _readIndex([`${root}/${themeId}`]);
    return index?.name ?? null;
}

function _iconRoots() {
    return [...new Set([
        GLib.get_user_data_dir(),
        ...GLib.get_system_data_dirs(),
    ].map(dir => GLib.build_filenamev([dir, 'icons'])).concat(FLATPAK_ICON_ROOTS))];
}

async function _findPacks() {
    const roots = _iconRoots();

    const themeDirs = new Map();
    for (const names of await Promise.all(roots.map(_childDirs))) {
        for (const path of names) {
            const id = GLib.path_get_basename(path);
            if (!themeDirs.has(id))
                themeDirs.set(id, []);
            themeDirs.get(id).push(path);
        }
    }

    const activeTheme = Gtk.Settings.get_default().gtk_icon_theme_name;
    const packs = await Promise.all([...themeDirs].map(async ([id, dirs]) => {
        const index = await _readIndex(dirs);
        return index ? {id, name: index.name, dirs} : null;
    }));
    return packs
        .filter(Boolean)
        .sort((a, b) => (b.id === activeTheme) - (a.id === activeTheme) || _byCodeUnits(a.name, b.name));
}

async function _childDirs(root) {
    const dir = Gio.File.new_for_path(root);
    const found = [];
    try {
        const children = await dir.enumerate_children_async('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null);
        for await (const info of children) {
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                found.push(children.get_child(info).get_path());
        }
    } catch {
        // A root that does not exist holds no packs
    }
    return found;
}

// Cursor themes carry an index.theme too, only icon themes list Directories,
// so get_string throws for them.
async function _readIndex(dirs) {
    const files = await Promise.all(dirs.map(dir =>
        readFileBytes(Gio.File.new_for_path(GLib.build_filenamev([dir, 'index.theme']))).catch(() => null)));
    const bytes = files.find(Boolean);
    if (!bytes)
        return null;
    const keyFile = new GLib.KeyFile();
    try {
        keyFile.load_from_bytes(new GLib.Bytes(bytes), GLib.KeyFileFlags.NONE);
        keyFile.get_string(ICON_THEME_GROUP, 'Directories');
        if (_readBoolean(keyFile, 'Hidden'))
            return null;
        return {name: keyFile.get_locale_string(ICON_THEME_GROUP, 'Name', null)};
    } catch {
        return null;
    }
}

function _readBoolean(keyFile, key) {
    try {
        return keyFile.get_boolean(ICON_THEME_GROUP, key);
    } catch {
        return false;
    }
}

// Plain order, localeCompare costs a frame or more on a pack this size.
function _byCodeUnits(a, b) {
    if (a === b)
        return 0;
    return a < b ? -1 : 1;
}

async function _scanPack(pack) {
    const scan = {candidates: new Map(), regular: new Set(), links: new Map(), best: new Map()};
    await Promise.all(pack.dirs.map(async dir => {
        const [cache, linkedDirs] = await Promise.all([_readFreshCache(dir), _linkedChildren(dir)]);
        if (!cache || !await _addCachedIcons(dir, cache, linkedDirs, scan))
            await _walk(dir, 0, scan);
    }));
    await _settleWalkedCandidates(scan);

    const names = [...scan.best.keys()].sort(_byCodeUnits);
    const folders = [];
    const folderSlots = new Map();
    const folderIndex = new Uint16Array(names.length);
    const isPng = new Uint8Array(names.length);
    names.forEach((name, i) => {
        const {folder, png} = scan.best.get(name);
        if (!folderSlots.has(folder)) {
            folderSlots.set(folder, folders.length);
            folders.push(folder);
        }
        folderIndex[i] = folderSlots.get(folder);
        isPng[i] = png ? 1 : 0;
    });
    Object.assign(pack, {names, folders, folderIndex, isPng});
    return pack;
}

// The walk keeps a few candidates per name to step past broken links. A
// link that leaves the pack goes to disk, a broken one drops out.
async function _settleWalkedCandidates(scan) {
    const unresolved = [];
    for (const [name, candidates] of scan.candidates) {
        const path = candidates.map(c => _resolveLocal(c.path, scan)).find(Boolean);
        if (path)
            _offerBest(scan, name, path, Infinity);
        else
            unresolved.push([name, candidates]);
    }
    await Promise.all(unresolved.map(async ([name, candidates]) => {
        const readable = await Promise.all(candidates.map(({path}) => _isReadableFile(path)));
        const path = candidates[readable.indexOf(true)]?.path;
        if (path)
            _offerBest(scan, name, path, Infinity);
    }));
}

// Follows a link chain through what the walk already saw, no disk access.
// Null means the chain left the pack or broke, and only the disk can tell.
function _resolveLocal(path, scan) {
    let current = path;
    for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
        if (scan.regular.has(current))
            return path;
        current = scan.links.get(current);
        if (!current)
            return null;
    }
    return null;
}

async function _isReadableFile(path) {
    try {
        const info = await Gio.File.new_for_path(path).query_info_async(
            'standard::type,access::can-read', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null);
        return info.get_file_type() === Gio.FileType.REGULAR && info.get_attribute_boolean('access::can-read');
    } catch {
        return false;
    }
}

function _offerBest(scan, name, path, score) {
    const current = scan.best.get(name);
    if (current && current.score >= score)
        return;
    const slash = path.lastIndexOf('/');
    scan.best.set(name, {folder: path.slice(0, slash), png: path.endsWith('.png'), score});
}

// GTK's own staleness rule, a cache older than its theme folder is ignored.
// A fresh cache spares listing every file of a pack.
async function _readFreshCache(dir) {
    const cacheFile = Gio.File.new_for_path(`${dir}/${ICON_CACHE_FILE}`);
    try {
        const [dirInfo, cacheInfo] = await Promise.all([Gio.File.new_for_path(dir), cacheFile].map(file =>
            file.query_info_async('time::modified', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null)));
        const isStale = cacheInfo.get_modification_date_time().to_unix() <
            dirInfo.get_modification_date_time().to_unix();
        return isStale ? null : await readFileBytes(cacheFile);
    } catch {
        return null;
    }
}

// Variants like Papirus-Dark link whole folders to their base pack. The
// cache lists those too, the walk does not follow them, and neither does this.
// Theme folders nest two deep, size then context.
async function _linkedChildren(dir, prefix = '', depth = 0) {
    const linked = new Set();
    const subdirs = [];
    try {
        const children = await Gio.File.new_for_path(`${dir}/${prefix}`).enumerate_children_async(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, null);
        await _drain(children, info => {
            const relative = prefix ? `${prefix}/${info.get_name()}` : info.get_name();
            if (info.get_file_type() === Gio.FileType.SYMBOLIC_LINK)
                linked.add(relative);
            else if (info.get_file_type() === Gio.FileType.DIRECTORY && depth < LINKED_DIR_DEPTH)
                subdirs.push(relative);
        });
    } catch {
        return linked;
    }
    const nested = await Promise.all(subdirs.map(subdir => _linkedChildren(dir, subdir, depth + 1)));
    nested.forEach(set => set.forEach(path => linked.add(path)));
    return linked;
}

// False for a cache this parser does not know, the walk takes over then.
async function _addCachedIcons(dir, bytes, linkedDirs, scan) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder();
    const readString = offset => decoder.decode(bytes.subarray(offset, bytes.indexOf(0, offset)));
    try {
        if (view.getUint16(0) !== CACHE_MAJOR || view.getUint16(2) !== CACHE_MINOR)
            return false;
        const dirList = view.getUint32(8);
        const dirNames = Array.from({length: view.getUint32(dirList)},
            (_unused, i) => readString(view.getUint32(dirList + 4 + 4 * i)));
        const isLinked = name => name.split('/')
            .some((_part, i, parts) => linkedDirs.has(parts.slice(0, i + 1).join('/')));
        const isSkipped = name => isLinked(name) || name.split('/').some(part => SKIPPED_DIRS.has(part));
        const dirPixels = dirNames.map(name => isSkipped(name) ? null : _pixels(`/${name}/`));
        const hash = view.getUint32(4);
        const cache = {dir, view, readString, dirNames, dirPixels, scan, hash, buckets: view.getUint32(hash)};
        await _addCachedBuckets(0, cache);
        return true;
    } catch {
        return false;
    }
}

// A slice per idle tick, a big pack's cache would block the main loop for a
// whole frame or more in one go.
async function _addCachedBuckets(from, cache) {
    const end = Math.min(from + CACHE_BUCKETS_PER_TICK, cache.buckets);
    for (let bucket = from; bucket < end; bucket++)
        _addCachedChain(cache.view.getUint32(cache.hash + 4 + 4 * bucket), cache);
    if (end === cache.buckets)
        return;
    await _nextIdle();
    await _addCachedBuckets(end, cache);
}

function _nextIdle() {
    return new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

// A malformed cache can loop its chain, the byte length bounds every walk.
function _addCachedChain(start, cache) {
    const {view} = cache;
    let steps = 0;
    for (let chain = start; chain !== CACHE_CHAIN_END && steps < view.byteLength; chain = view.getUint32(chain)) {
        steps++;
        _addCachedIcon(chain, cache);
    }
}

// A theme lists one icon in many size folders, only its best source becomes
// a path, so a big pack never holds a string per file.
function _addCachedIcon(chain, {dir, view, readString, dirNames, dirPixels, scan}) {
    const name = readString(view.getUint32(chain + 4));
    if (SYMBOLIC_NAME_RE.test(name) || name.endsWith(SYMBOLIC_PNG_SUFFIX))
        return;
    const images = view.getUint32(chain + 8);
    let best = null;
    for (let i = 0; i < view.getUint32(images); i++) {
        const image = images + 4 + CACHE_IMAGE_SIZE * i;
        const dirIndex = view.getUint16(image);
        const extension = _cachedExtension(view.getUint16(image + 2));
        const pixels = dirPixels[dirIndex];
        if (!extension || pixels === null || pixels === undefined)
            continue;
        const score = _sourceScore(pixels, extension === '.svg');
        if (!best || score > best.score)
            best = {score, dirIndex, extension};
    }
    if (!best)
        return;
    _offerBest(scan, name, `${dir}/${dirNames[best.dirIndex]}/${name}${best.extension}`, best.score);
}

function _cachedExtension(flags) {
    if (flags & CACHE_FLAG_SVG)
        return '.svg';
    return flags & CACHE_FLAG_PNG ? '.png' : null;
}

// Links are not followed while walking. A pack like Papirus links most of its
// files and whole @2x directories, so following them would read everything
// twice.
async function _walk(dirPath, depth, scan) {
    let children;
    try {
        children = await Gio.File.new_for_path(dirPath).enumerate_children_async(WALK_ATTRIBUTES,
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, null);
    } catch {
        return;
    }
    const subdirs = [];
    await _drain(children, info => _addEntry(dirPath, info, depth, scan, subdirs));
    await Promise.all(subdirs.map(subdir => _walk(subdir, depth + 1, scan)));
}

// Batches, a directory of a big pack holds thousands of files and the
// async iterator would take them one round trip at a time.
async function _drain(children, onInfo) {
    const infos = await children.next_files_async(ENUMERATE_BATCH, GLib.PRIORITY_LOW, null);
    if (infos.length === 0)
        return;
    infos.forEach(onInfo);
    await _drain(children, onInfo);
}

function _addEntry(dirPath, info, depth, scan, subdirs) {
    const fileName = info.get_name();
    const type = info.get_file_type();
    const path = `${dirPath}/${fileName}`;
    if (type === Gio.FileType.DIRECTORY) {
        if (depth < WALK_MAX_DEPTH && !SKIPPED_DIRS.has(fileName))
            subdirs.push(path);
        return;
    }
    if (!ICON_EXTENSIONS_RE.test(fileName))
        return;
    const name = fileName.replace(ICON_EXTENSIONS_RE, '');
    if (SYMBOLIC_NAME_RE.test(name))
        return;

    if (type === Gio.FileType.SYMBOLIC_LINK)
        scan.links.set(path, GLib.canonicalize_filename(info.get_symlink_target(), dirPath));
    else if (type === Gio.FileType.REGULAR && info.get_attribute_boolean('access::can-read'))
        scan.regular.add(path);
    else
        return;

    _addCandidate(scan, name, path);
}

function _addCandidate(scan, name, path) {
    const candidates = scan.candidates.get(name) ?? [];
    candidates.push({path, score: _score(path)});
    candidates.sort((a, b) => b.score - a.score);
    candidates.length = Math.min(candidates.length, MAX_CANDIDATES);
    scan.candidates.set(name, candidates);
}

function _score(path) {
    return _sourceScore(_pixels(path), path.endsWith('.svg'));
}

// An SVG first, the largest drawn one, since some packs keep SVGs drawn for
// 16px in their size folders. A bitmap is decoded at its own size, so the
// smallest one that still covers a cell at scale 2, a 256px one would cost
// a hundred times the memory for the same thumbnail.
function _sourceScore(pixels, isSvg) {
    if (isSvg)
        return SVG_SCORE + pixels;
    return pixels >= BITMAP_TARGET_PX ? BITMAP_TARGET_SCORE - pixels : pixels;
}

function _pixels(path) {
    if (path.includes(SCALABLE_SEGMENT))
        return SCALABLE_SIZE;
    const size = path.match(SIZE_SEGMENT_RE);
    return size ? Number(size[1]) * Number(size[2] ?? 1) : 0;
}
