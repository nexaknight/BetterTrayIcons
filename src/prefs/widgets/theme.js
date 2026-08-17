import Adw from 'gi://Adw';

import {createTextureFromBytes} from './gtkHelpers.js';

export function bindLogoToTheme(logo, fallback, assetsDir, darkFile) {
    let darkSvg = null;

    return _bindToStyleManager(() => {
        const isDark = Adw.StyleManager.get_default().dark;

        darkSvg ??= _readSvgString(assetsDir, darkFile);
        let svgStr = darkSvg;
        if (svgStr && !isDark)
            svgStr = _recolorWhiteToBlack(svgStr);

        const texture = svgStr
            ? createTextureFromBytes(new TextEncoder().encode(svgStr))
            : null;

        if (texture) {
            logo.set_paintable(texture);
            logo.visible = true;
            fallback.visible = false;
        } else {
            logo.visible = false;
            fallback.visible = true;
        }
    });
}


function _bindToStyleManager(update) {
    const styleManager = Adw.StyleManager.get_default();
    const id = styleManager.connect('notify::dark', update);
    update();
    return id;
}

function _readSvgString(assetsDir, filename) {
    const file = assetsDir.get_child(filename);
    if (!file.query_exists(null))
        return null;
    const [, contents] = file.load_contents(null);
    return new TextDecoder().decode(contents);
}

// Light theme needs dark strokes. Only the stroke forms though, the logo's
// fill colors have to survive.
function _recolorWhiteToBlack(svgStr) {
    return svgStr
        .replaceAll('stroke="white"', 'stroke="black"')
        .replaceAll('stroke:white', 'stroke:black')
        .replaceAll('stroke="#FFF"', 'stroke="#000"');
}

