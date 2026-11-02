import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import System from 'system';

import {error} from '../../shared/logging.js';
import {readPixbufAtSize} from '../../shared/asyncIo.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {withAlign} from './text.js';

// glycin decodes in its sandboxed loader process and answers asynchronously.
// gdk-pixbuf's stream loader runs the same decode on the main loop when it
// closes, so it is only the fallback for a system without glycin.
const Gly = await import('gi://Gly?version=2').then(module => module.default).catch(() => null);
const GlyGtk4 = Gly ? await import('gi://GlyGtk4?version=2').then(module => module.default).catch(() => null) : null;
if (GlyGtk4) {
    Gio._promisify(Gly.Loader.prototype, 'load_async', 'load_finish');
    Gio._promisify(Gly.Image.prototype, 'get_specific_frame_async', 'get_specific_frame_finish');
}

const _frameRequests = new Map();

// glycin answers no more requests once a few thousand of its images are
// alive, and an image only goes when the garbage collector frees its
// wrapper. That wrapper is too small to make GJS collect on its own.
const LOADS_PER_COLLECTION = 500;
let _loadsSinceCollection = 0;

function _frameRequest(size) {
    if (!_frameRequests.has(size)) {
        const request = new Gly.FrameRequest();
        request.set_scale(size, size);
        _frameRequests.set(size, request);
    }
    return _frameRequests.get(size);
}

export async function readIconTexture(path, size, cancellable = null) {
    const file = Gio.File.new_for_path(path);
    if (!GlyGtk4)
        return Gdk.Texture.new_for_pixbuf(await readPixbufAtSize(file, size, cancellable));
    if (++_loadsSinceCollection >= LOADS_PER_COLLECTION) {
        _loadsSinceCollection = 0;
        System.gc();
    }
    const image = await Gly.Loader.new(file).load_async(cancellable);
    return GlyGtk4.frame_get_texture(await image.get_specific_frame_async(_frameRequest(size), cancellable));
}

export function createPicture(params = {}) {
    const {halign, valign, ...props} = params;
    return withAlign(new Gtk.Picture(props), halign, valign);
}

export function createImage(params = {}) {
    const {halign, valign, ...props} = params;
    return withAlign(new Gtk.Image(props), halign, valign);
}

export function createAvatar(params = {}) {
    const {size = 32, text = '', showInitials = true, valign, halign, ...props} = params;
    return withAlign(new Adw.Avatar({
        size,
        text,
        show_initials: showInitials,
        ...props,
    }), halign, valign);
}

export function createTextureFromBytes(bytes) {
    try {
        const loader = new GdkPixbuf.PixbufLoader();
        loader.write(bytes.get_data ? bytes.get_data() : bytes);
        loader.close();
        return Gdk.Texture.new_for_pixbuf(loader.get_pixbuf());
    } catch (e) {
        error(`Failed to create texture: ${e.message}`);
        return null;
    }
}

export function bindLogoToTheme(logo, fallback, assetsDir, darkFile) {
    let darkSvg = null;

    const update = () => {
        const isDark = Adw.StyleManager.get_default().dark;

        darkSvg ??= _readSvgString(assetsDir, darkFile);
        let svg = darkSvg;
        if (svg && !isDark)
            svg = _recolorWhiteToBlack(svg);

        const texture = svg
            ? createTextureFromBytes(new TextEncoder().encode(svg))
            : null;

        if (texture) {
            logo.set_paintable(texture);
            logo.visible = true;
            fallback.visible = false;
        } else {
            logo.visible = false;
            fallback.visible = true;
        }
    };

    connectScoped(logo, Adw.StyleManager.get_default(), 'notify::dark', update);
    update();
}

function _readSvgString(assetsDir, filename) {
    const file = assetsDir.get_child(filename);
    if (!file.query_exists(null))
        return null;
    const [, contents] = file.load_contents(null);
    return new TextDecoder().decode(contents);
}

// Light theme needs dark strokes, but only the stroke forms, the logo's fill
// colors have to survive.
function _recolorWhiteToBlack(svg) {
    return svg
        .replaceAll('stroke="white"', 'stroke="black"')
        .replaceAll('stroke:white', 'stroke:black')
        .replaceAll('stroke="#FFF"', 'stroke="#000"');
}
