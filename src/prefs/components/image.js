import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import GdkPixbuf from 'gi://GdkPixbuf';

import {error} from '../../shared/logging.js';
import {withAlign} from './text.js';

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

    const handlerId = Adw.StyleManager.get_default().connect('notify::dark', update);
    update();
    return handlerId;
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
