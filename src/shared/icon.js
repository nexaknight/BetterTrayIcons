import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warnOnce} from './logging.js';
import {fileExists, readFileBytes, readFileText, probePaths} from './fetch.js';
import {usesAccent} from './accentColor.js';

// symbolic is the freedesktop convention, panel the Ubuntu/ayatana one.
const MONO_ICON_SUFFIXES = Object.freeze(['-symbolic', '-panel']);
const MONO_VARIANTS = MONO_ICON_SUFFIXES.map(s => s.slice(1)).join('|');

// Bare "mono" marks monochrome assets without being a theme variant
// suffix, so it isn't in the list above.
const MONO_ICON_NAME_RE = new RegExp(`[-_](${MONO_VARIANTS}|mono)$`, 'i');

// Fallback-asset names like steam_tray_mono, from apps without theme
// integration. Stripping them reveals the base name a theme can cover,
// while -symbolic and -panel names are deliberate choices and stay as is.
export const MONO_ASSET_SUFFIX_RE = /([-_]tray)?[-_]mono$/i;

const ICON_CACHE_SUBDIR = 'bettertrayicons/icons';

const ICON_FILE_EXTENSIONS = Object.freeze(['.png', '.svg', '.xpm', '.ico']);

// Deep enough for <path>/hicolor/22x22/apps/foo.png, shallow enough that an
// app pointing IconThemePath at a large tree can't stall a resolve.
const ICON_THEME_TREE_MAX_DEPTH = 4;

// A snap carries its revision ahead of the theme tree
// (/snap/x/123/hicolor/48x48/apps/y.png), so the size is the last size-shaped
// segment, not the first. The lookahead leaves the trailing slash behind so
// /123/16x16/ still yields both. Scaled dirs (16x16@2x, 128x128@2) must match
// too, or the last match falls back onto the revision.
const ICON_THEME_SIZE_RE = /\/(\d+)(?:x\d+)?(?:@\d+x?)?(?=\/)/g;

// Feed the result to resolveIcon and applyResolvedIcon so neither stats while
// a widget is being built. Theme lookups ride in the same map under
// themeProbeKey, false in there means probed and missed.
export async function probeIconPaths(configs, cancellable = null) {
    const paths = new Set();
    const themed = new Map();
    for (const config of configs) {
        for (const p of [config.custom_icon, config.cached_icon_path]) {
            if (typeof p === 'string' && p.startsWith('/'))
                paths.add(p);
        }
        const key = themeProbeKey(config);
        if (key && !themed.has(key))
            themed.set(key, config);
    }

    const map = await probePaths(paths, cancellable);
    await Promise.all([...themed].map(async ([key, config]) => {
        const hit = await findIconInThemeAsync(
            config.detected_icon, config.icon_theme_path, {cancellable});
        map.set(key, hit ?? false);
    }));
    return map;
}

// Null when resolveIcon could never reach the theme walk for this config.
export function themeProbeKey(config) {
    const name = config.detected_icon;
    if (config.custom_icon || !name || name.startsWith('/') || !config.icon_theme_path)
        return null;
    return `${config.icon_theme_path}\0${name}`;
}

// Only the prefs side has an icon theme at hand to answer `hasThemeIcon`.
export function resolveIcon(config, hasThemeIcon = null, cachedPathExists = null, themeHit = null) {
    if (config.custom_icon) {
        if (config.custom_icon.startsWith('/'))
            return {type: 'file', value: config.custom_icon};

        return {type: 'name', value: config.custom_icon};
    }

    const iconName = config.detected_icon;

    // A resolvable name beats any cached copy. The theme recolors it for
    // light and dark and renders it at the exact size, a snapshot does
    // neither. Also repairs entries an older version polluted with a copy
    // of the theme file.
    if (iconName && !iconName.startsWith('/') && hasThemeIcon?.(iconName))
        return {type: 'name', value: iconName};

    // Without this check, a stale cached path would show as image-missing
    // instead of falling back to the themed name below.
    if (config.cached_icon_path) {
        const exists = cachedPathExists ??
            Gio.File.new_for_path(config.cached_icon_path).query_exists(null);
        if (exists)
            return {type: 'file', value: config.cached_icon_path};
    }

    if (iconName) {
        if (iconName.startsWith('/'))
            return {type: 'file', value: iconName};

        if (config.icon_theme_path && themeHit)
            return {type: 'file', value: themeHit};

        return {type: 'name', value: iconName};
    }

    return {type: 'name', value: 'image-missing'};
}

export async function findIconInThemeAsync(iconName, themePath, {targetSize = 0, cancellable = null} = {}) {
    const {wanted, paths} = _candidatePaths(iconName, themePath);
    const found = await Promise.all(paths.map(p => fileExists(p, cancellable)));
    const first = found.indexOf(true);
    if (first !== -1)
        return paths[first];

    return _findIconInThemeTree(Gio.File.new_for_path(themePath), wanted, targetSize, cancellable);
}

// A bare name can also be a file with its extension already attached, so
// both spellings are probed, flat first and then the theme tree.
function _candidatePaths(iconName, themePath) {
    const candidates = [iconName, ...ICON_FILE_EXTENSIONS.map(ext => `${iconName}${ext}`)];
    const cleanPath = themePath.endsWith('/') ? themePath : `${themePath}/`;
    return {wanted: new Set(candidates), paths: candidates.map(cand => `${cleanPath}${cand}`)};
}

async function _findIconInThemeTree(dir, wanted, targetSize, cancellable) {
    let best = null;
    let bestScore = Infinity;

    const walk = async (current, depth) => {
        if (depth > ICON_THEME_TREE_MAX_DEPTH)
            return;
        let children;
        try {
            children = await current.enumerate_children_async('standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
        } catch {
            return;
        }
        for await (const info of children) {
            const child = children.get_child(info);
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                await walk(child, depth + 1);
                continue;
            }
            if (!wanted.has(info.get_name()))
                continue;
            const score = _sizeDistance(child.get_path(), targetSize);
            // A tree whose paths carry no size segment scores every file
            // Infinity, and Infinity < Infinity kept none of them, so a
            // matching file sitting right there resolved to nothing.
            if (best === null || score < bestScore) {
                bestScore = score;
                best = child.get_path();
            }
        }
    };
    await walk(dir, 0);

    return best;
}

// Scalable art fits every slot, so it wins unless a raster variant matches
// the requested size exactly.
function _sizeDistance(path, targetSize) {
    if (path.endsWith('.svg'))
        return 0.5;
    if (!targetSize)
        return 1;
    const sizes = [...path.matchAll(ICON_THEME_SIZE_RE)];
    return sizes.length ? Math.abs(Number(sizes.at(-1)[1]) - targetSize) : Infinity;
}

// For the prefs side only. GTK falls back to image-missing on its own, and
// spelling it out here would bury a name it could still resolve (see
// orderThemedNames). St needs the opposite, which orderThemedNames handles.
export function themedIcon(name) {
    return new Gio.ThemedIcon({name});
}

export function pathOrThemedIcon(value, exists) {
    if (value.startsWith('/')) {
        const file = Gio.File.new_for_path(value);
        return exists ? new Gio.FileIcon({file}) : themedIcon('image-missing');
    }
    return themedIcon(value);
}

// Below this HSV saturation a declared color counts as neutral and follows the
// tint, brand colors sit well above the line.
const TINT_SAT_THRESHOLD = 0.25;

// `color` is in here because it is what currentColor resolves to, and the KDE
// convention keeps every chromatic value there.
const DECLARED_COLOR_RE = /(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi;

// KDE paints an ordinary icon part with the text class and keeps the semantic
// ones (PositiveText, NegativeText) for status, so only the text one may take
// the tint. Papirus files a brand color under it, which is why it is checked
// before being repainted.
const COLOR_SCHEME_PREFIX = 'ColorScheme-';
const COLOR_SCHEME_TEXT_CLASS = `${COLOR_SCHEME_PREFIX}Text`;
const COLOR_SCHEME_TEXT_RE = new RegExp(
    `\\.${COLOR_SCHEME_TEXT_CLASS}\\s*\\{[^}]*?color\\s*:\\s*(#[0-9a-f]{3,8}|rgba?\\([^)]*\\))`, 'i');

// Only parts naming no color take the tint. Without the inherit rule the
// children of a `<g fill>` group lose theirs.
const _tintColoredCss = (color, neutralText) =>
    `svg{color:${color}}*:not([fill]){fill:${color}}[fill] *{fill:inherit}${neutralText
        ? `.${COLOR_SCHEME_TEXT_CLASS},.foreground,.foreground-fill{color:${color};fill:${color}}`
        : ''}`;

// Nothing chromatic to protect, so the tint wins everywhere. fill="none" is
// spared because forcing a fill onto a stroke-drawn outline paints it as a
// solid blob, and the stroke takes the tint as well, which neither toolkit does.
const _tintMonoCss = color =>
    `*{fill:${color}!important;color:${color}}` +
    '[fill="none"]{fill:none!important}' +
    `[stroke]:not([stroke="none"]){stroke:${color}!important}`;

// Both toolkits classify by file name alone (st-icon-theme.c
// icon_uri_is_symbolic), so a mono icon under a plain name renders black.
// Matching none of the three leaves the icon's own paint alone, which is what
// keeps grayscale logos intact.
const MONO_NAME_RE = new RegExp(`-(${MONO_VARIANTS})\\.svg$`, 'i');
const MONO_DIR_RE = new RegExp(`/(${MONO_VARIANTS})/`);
const MONO_CLASS_RE = new RegExp(
    `currentColor|${COLOR_SCHEME_PREFIX}|class\\s*=\\s*["'](?:fg|foreground|success|warning|error)`, 'i');

function _wantsTint(path, text) {
    return MONO_NAME_RE.test(path) || MONO_DIR_RE.test(path) || MONO_CLASS_RE.test(text);
}

// The color neutral parts take, matching a normal symbolic tray icon. The
// accent has to come from the caller, since St resolves it from a theme node
// and GTK from Adw, and a stale icon-color would win over it otherwise.
export function symbolicTint(settings, accentColor = null) {
    if (!settings.get_boolean('enable-custom-icon-style'))
        return '#ffffff';
    const value = settings.get_string('icon-color');
    if (accentColor && usesAccent(value))
        return accentColor;
    return value;
}

// Tinted bytes live only in memory, so the panel never writes to the SSD.
// Dropping the whole map on overflow costs one cheap rebuild instead of LRU
// bookkeeping, and a failed read is kept as null so no render retries it.
const TINT_CACHE_MAX = 128;
const _tintCache = new Map();

// A themed NAME carries no bytes, so the caller hands in its own toolkit's
// lookup. size is in DEVICE pixels, 0 leaves the file's own size alone.
export async function tintedSymbolicIcon(value, tint, {size = 0, lookupThemeFile = null, cancellable = null} = {}) {
    const path = typeof value === 'string' && value.startsWith('/')
        ? value
        : lookupThemeFile?.(value);
    const color = _cssColor(tint);
    // Only an SVG has somewhere to put a stylesheet.
    if (!color || !path?.toLowerCase().endsWith('.svg'))
        return null;

    const key = `${path}\0${color}\0${size}`;
    if (_tintCache.has(key))
        return _tintCache.get(key);

    const gicon = await _tintedIcon(path, color, size, cancellable);
    if (_tintCache.size >= TINT_CACHE_MAX)
        _tintCache.clear();
    _tintCache.set(key, gicon);
    return gicon;
}

export function clearTintCache() {
    _tintCache.clear();
}

export async function tintedSymbolicIconMap(values, tint, options = {}) {
    const map = new Map();
    await Promise.all([...new Set(values)].map(async value => {
        const gicon = await tintedSymbolicIcon(value, tint, options);
        if (gicon)
            map.set(value, gicon);
    }));
    return map;
}

async function _tintedIcon(path, color, size, cancellable) {
    try {
        const text = await readFileText(Gio.File.new_for_path(path), cancellable);
        if (!_wantsTint(path, text))
            return null;
        const svg = _tintedSvg(text, color, size);
        return svg
            ? Gio.BytesIcon.new(GLib.Bytes.new(new TextEncoder().encode(svg)))
            : null;
    } catch {
        return null;
    }
}

// GTK also drops fill-rule cutouts on such a file, so a ring arrives as a solid
// disc. A gicon without a filename escapes both pipelines, and the rule goes
// last to outrank a stylesheet the icon carries itself.
function _tintedSvg(text, color, size) {
    const chroma = _declaresChroma(text);
    const css = chroma
        ? _tintColoredCss(color, _neutralTextClass(text))
        : _tintMonoCss(color);
    // The rewrite runs on the source rather than through CSS because no selector
    // can ask what color a declaration carries.
    const body = chroma ? _retintNeutrals(text, color) : text;
    const end = body.lastIndexOf('</svg');
    if (end < 0)
        return null;
    const styled = `${body.slice(0, end)}<style type="text/css">${css}</style>${body.slice(end)}`;
    return size > 0 ? _sizedSvg(styled, size) : styled;
}

// Without this an icon that paints itself black sits invisible on a dark panel.
function _retintNeutrals(text, color) {
    return text.replace(DECLARED_COLOR_RE, (declaration, value) =>
        _isChromatic(_parseRgb(value)) ? declaration : declaration.replace(value, color));
}

// GTK and St render the SVG at its own declared size, not the requested one
// (gtkiconpaintable.c), so the size is written into the bytes. Without a
// viewBox one is added from the old size, or the resize would crop.
function _sizedSvg(text, px) {
    // The root can carry a namespace prefix, and MoreWaita ships icons whose
    // root really is <svg:svg>. Anything new is spliced in after the element
    // NAME, because replacing the literal "<svg" would land inside that name.
    const tag = text.match(/<([A-Za-z_][\w.-]*:)?svg\b[^>]*>/);
    if (!tag)
        return text;
    const elementName = tag[0].match(/^<[^\s/>]+/)[0];
    const addAttr = (open, attr) => elementName + attr + open.slice(elementName.length);

    // Inkscape writes single quotes in some icons, and reading those as absent
    // would append a second width and break the XML.
    const attrRe = name => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    const read = name => {
        const found = tag[0].match(attrRe(name));
        return found ? found[1] ?? found[2] : null;
    };
    const asNumber = value => value?.match(/^\s*([0-9.]+)\s*(?:px)?\s*$/)?.[1] ?? null;
    const [width, height] = [read('width'), read('height')];

    let open = tag[0];
    if (!read('viewBox')) {
        const [w, h] = [asNumber(width), asNumber(height)];
        if (!w || !h)
            return text;
        open = addAttr(open, ` viewBox="0 0 ${w} ${h}"`);
    }
    for (const [name, present] of [['width', width], ['height', height]]) {
        open = present === null
            ? addAttr(open, ` ${name}="${px}"`)
            : open.replace(attrRe(name), ` ${name}="${px}"`);
    }
    return text.slice(0, tag.index) + open + text.slice(tag.index + tag[0].length);
}

function _declaresChroma(text) {
    DECLARED_COLOR_RE.lastIndex = 0;
    let match;
    while ((match = DECLARED_COLOR_RE.exec(text)) !== null) {
        if (_isChromatic(_parseRgb(match[1])))
            return true;
    }
    return false;
}

function _neutralTextClass(text) {
    const declared = text.match(COLOR_SCHEME_TEXT_RE);
    return !declared || !_isChromatic(_parseRgb(declared[1]));
}

function _isChromatic(rgb) {
    if (!rgb)
        return false;
    const [r, g, b] = rgb;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max > 0 && (max - min) / max >= TINT_SAT_THRESHOLD;
}

// An unreadable value is refused, librsvg would render it black. Alpha is kept
// because libadwaita's own text color carries one and the icon has to match
// what sits next to it.
function _cssColor(tint) {
    const rgb = _parseRgb(tint);
    if (!rgb)
        return null;
    const [r, g, b, alpha] = rgb;
    return alpha < 1
        ? `rgba(${r},${g},${b},${alpha})`
        : `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// The forms a color reaches us in: #rgb and #rrggbb from gsettings, the same
// with a trailing alpha from St's to_string, and rgb()/rgba() from GTK.
function _parseRgb(color) {
    const hex = color.trim().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
        const h = hex[1];
        const wide = h.length > 4;
        const part = i => parseInt(wide ? h.slice(i * 2, i * 2 + 2) : h[i].repeat(2), 16);
        const carriesAlpha = h.length === 4 || h.length === 8;
        return [part(0), part(1), part(2), carriesAlpha ? part(3) / 255 : 1];
    }
    const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/i);
    return rgb
        ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
        : null;
}

// GTK and St walk a multi-name icon differently (gtkicontheme.c themes-first,
// st-icon-theme.c names-first). A name we know resolves goes first, that wins
// under both. image-missing sits last because St paints nothing otherwise,
// but under GTK it would bury names further down the theme chain. With no
// theme answer yet the render-time lookup decides, without a pinned fallback.
export function orderThemedNames(candidates, existing, themeKnown = true) {
    if (existing)
        return [existing, ...candidates.filter(n => n !== existing)];
    return themeKnown ? [...candidates, 'image-missing'] : candidates;
}

export function buildSymbolicCandidates(name, useSymbolic) {
    const base = name.replace(MONO_ASSET_SUFFIX_RE, '');
    if (base && base !== name) {
        const variants = MONO_ICON_SUFFIXES.map(suffix => `${base}${suffix}`);
        return useSymbolic ? [...variants, name, base] : [base, name];
    }

    if (MONO_ICON_NAME_RE.test(name))
        return [name];

    const variants = MONO_ICON_SUFFIXES.map(suffix => `${name}${suffix}`);
    return useSymbolic ? [...variants, name] : [name, ...variants];
}

let _cacheDirPath = null;

export async function writeCachedIcon(appId, pngBytes) {
    const path = _cachedIconPath(appId);
    if (!path)
        return null;
    const file = Gio.File.new_for_path(path);

    try {
        if (file.query_exists(null)) {
            const existing = await readFileBytes(file);
            if (existing.length === pngBytes.length && _bytesEqual(existing, pngBytes))
                return path;
        }

        // Async so a frame's cache write never blocks the compositor.
        await file.replace_contents_async(
            GLib.Bytes.new(pngBytes),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );
        return path;
    } catch (e) {
        warnOnce(`icon-cache-write:${appId}`, `iconCache: write failed for ${appId}: ${e.message}`);
        return null;
    }
}

// The file can vanish between the exists check and the delete.
export function deleteCachedIcon(appId) {
    const path = _cachedIconPath(appId);
    if (!path)
        return;
    const file = Gio.File.new_for_path(path);
    try {
        if (file.query_exists(null))
            file.delete(null);
    } catch { /* gone */ }
}

function _cachedIconPath(appId) {
    // An app-config key reaches here as the file name, and an imported sync
    // file or a hand-edited dconf value never passed through sanitizeAppId.
    // GLib.build_filenamev keeps a '..' hop, Gio.File then resolves it.
    if (!appId || appId.includes('/'))
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
            warnOnce('icon-cache-dir', `iconCache: could not create ${_cacheDirPath}: ${e.message}`);
        }
    }
    return _cacheDirPath;
}

function _bytesEqual(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }

    return true;
}
