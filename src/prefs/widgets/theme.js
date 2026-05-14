import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import GdkPixbuf from 'gi://GdkPixbuf';

import {warn} from '../../shared/logging.js';

function _readSvgString(mediaDir, filename) {
    const file = mediaDir.get_child(filename);
    if (!file.query_exists(null))
        return null;
    const [success, contents] = file.load_contents(null);
    return success ? new TextDecoder().decode(contents) : null;
}

// Light theme needs dark strokes/fills, so white is rewritten to black.
function _recolorWhiteToBlack(svgStr, {strict = false} = {}) {
    if (strict) {
        // Logo path: only rewrite stroke="white" forms, leaves fill colors alone.
        return svgStr
            .replaceAll('stroke="white"', 'stroke="black"')
            .replaceAll('stroke:white', 'stroke:black')
            .replaceAll('stroke="#FFF"', 'stroke="#000"');
    }
    return svgStr
        .replace(/fill=["']?#fff(fff)?["']?/gi, 'fill="#000000"')
        .replace(/fill=["']?white["']?/gi, 'fill="#000000"')
        .replace(/stroke=["']?#fff(fff)?["']?/gi, 'stroke="#000000"')
        .replace(/stroke=["']?white["']?/gi, 'stroke="#000000"');
}

function _svgToPixbuf(svgStr) {
    const loader = new GdkPixbuf.PixbufLoader();
    loader.write(new TextEncoder().encode(svgStr));
    loader.close();
    return loader.get_pixbuf();
}

function _bindToStyleManager(update) {
    const styleManager = Adw.StyleManager.get_default();
    const id = styleManager.connect('notify::dark', update);
    update();
    return id;
}

// Without a `lightFile` the dark SVG's white strokes are inverted to black.
export function bindLogoToTheme(logo, fallback, mediaDir, darkFile, lightFile = null) {
    const cache = {dark: null, light: null};

    return _bindToStyleManager(() => {
        const isDark = Adw.StyleManager.get_default().dark;

        let svgStr = null;
        if (!isDark && lightFile) {
            cache.light ??= _readSvgString(mediaDir, lightFile);
            svgStr = cache.light;
        }
        if (!svgStr) {
            cache.dark ??= _readSvgString(mediaDir, darkFile);
            svgStr = cache.dark;
            if (svgStr && !isDark)
                svgStr = _recolorWhiteToBlack(svgStr, {strict: true});
        }

        if (svgStr) {
            logo.set_paintable(Gdk.Texture.new_for_pixbuf(_svgToPixbuf(svgStr)));
            logo.visible = true;
            if (fallback)
                fallback.visible = false;
        } else {
            logo.visible = false;
            if (fallback)
                fallback.visible = true;
        }
    });
}

// Like bindLogoToTheme but for non-logo icons that need pixel-exact sizing.
export function bindSvgIconToTheme(image, mediaDir, filename, size = 0) {
    return _bindToStyleManager(() => {
        const file = mediaDir.get_child(filename);
        if (!file.query_exists(null)) {
            warn(`Icon file not found: ${file.get_path()}`);
            return;
        }

        let svgStr = _readSvgString(mediaDir, filename);
        if (!svgStr)
            return;

        if (!Adw.StyleManager.get_default().dark)
            svgStr = _recolorWhiteToBlack(svgStr);

        let pixbuf = _svgToPixbuf(svgStr);
        if (pixbuf && size > 0)
            pixbuf = pixbuf.scale_simple(size, size, GdkPixbuf.InterpType.BILINEAR);


        if (pixbuf) {
            image.set_paintable(Gdk.Texture.new_for_pixbuf(pixbuf));
            if (size > 0)
                image.set_size_request(size, size);
            image.visible = true;
        }
    });
}
