import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';

import {buildSymbolicCandidates, orderThemedNames, themedIcon, pathOrThemedIcon, probeIconPaths, tintedSymbolicIcon, symbolicTint} from '../../shared/iconLoading.js';
import {fileExists} from '../../shared/asyncIo.js';
import {editsLightSet} from './color.js';

export const NEXT_ICON_NAME = 'bti-next-symbolic';
export const GEAR_ICON_NAME = 'bti-gear-symbolic';

// Past the raster sizes a symbolic icon ships in, so the scalable directory is
// the only zero-distance match (gtkicontheme.c compare_dir_size_matches).
const THEME_FILE_LOOKUP_PX = 128;

let _iconTheme = null;
export function hasThemeIcon(name) {
    _iconTheme ??= Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    return _iconTheme.has_icon(name);
}

export function applyPathIcon(image, value, settings, options = {}) {
    if (!value) {
        image.clear();
        return;
    }

    image._btiPendingIcon = value;
    const isPath = value.startsWith('/');

    if (!isPath && !options.tint) {
        image.set_from_gicon(pathOrThemedIcon(value));
        return;
    }
    if (!isPath) {
        applyTintedIcon(image, value, settings, options);
        return;
    }

    // Probing is async, so a fast typist can outrun it. Only the value the
    // image is showing now gets to paint.
    Promise.all([fileExists(value), _tintedFor(value, settings, image, options)]).then(([exists, tinted]) => {
        if (image._btiPendingIcon !== value)
            return;
        image.set_from_gicon(tinted ?? pathOrThemedIcon(value, exists));
    });
}

export function prefsSymbolicTint(settings) {
    return symbolicTint(settings, {
        accent: Adw.StyleManager.get_default().get_accent_color_rgba().to_string(),
        light: editsLightSet(settings),
    });
}

// libadwaita's window_fg_color, read off a realized widget. An unparented
// Gtk.Image reports white in either scheme, which would paint light-mode icons
// invisible.
const PREFS_FG_DARK = '#ffffff';
const PREFS_FG_LIGHT = 'rgba(0,0,6,0.8)';

export function prefsForegroundColor() {
    return Adw.StyleManager.get_default().get_dark() ? PREFS_FG_DARK : PREFS_FG_LIGHT;
}

// Guarded by has_icon because lookup_icon never returns null, it falls back to
// image-missing, and tinting that would paint the fallback everywhere.
export function themeIconFile(name) {
    if (!name || !hasThemeIcon(name))
        return null;
    const paintable = _iconTheme.lookup_icon(
        name, null, THEME_FILE_LOOKUP_PX, 1, Gtk.TextDirection.LTR, 0);
    return paintable.get_file()?.get_path();
}

function _tintedFor(value, settings, image, {tint = null} = {}) {
    return tintedSymbolicIcon(value, tint ?? prefsSymbolicTint(settings),
        {size: devicePixelSize(image), lookupThemeFile: themeIconFile});
}

// pixel_size stays -1 until a caller sets one, and GTK then sizes from the
// icon-size enum, which is not readable from here.
export function devicePixelSize(widget, px = null) {
    const size = px ?? widget.pixel_size;
    return size > 0 ? size * widget.get_scale_factor() : 0;
}

// No themed icon first, GTK draws nothing at all for some app logos,
// slack-symbolic and devpod-symbolic in MoreWaita among them.
export function applyTintedIcon(image, name, settings, options = {}) {
    if (!name)
        return;
    image._btiPendingIcon = name;
    _tintedFor(name, settings, image, options).then(tinted => {
        if (image._btiPendingIcon === name)
            image.set_from_gicon(tinted ?? themedIcon(name));
    });
}

// GTK renders a FileIcon whose file is gone as something other than
// image-missing. A freshly picked icon is not in the probed map and can sit on
// a network mount, so file results are probed off the render path.
export function applyIconPreview(image, iconResult, settings) {
    const useSymbolic = settings.get_boolean('enable-symbolic-icons');
    const value = iconResult?.value;
    if (iconResult?.type !== 'file') {
        applyResolvedIcon(image, iconResult, useSymbolic);
        applyTintedIcon(image, value, settings);
        return;
    }
    image._btiPendingIcon = value;
    Promise.all([
        probeIconPaths([{custom_icon: value}]),
        _tintedFor(value, settings, image),
    ]).then(([paths, tinted]) => {
        if (image._btiPendingIcon === value)
            applyResolvedIcon(image, iconResult, useSymbolic, paths, tinted);
    });
}

export function applyResolvedIcon(image, iconResult, useSymbolic, iconPaths = null, tintedGicon = null) {
    if (!iconResult) {
        image.clear();
        return;
    }

    if (tintedGicon) {
        image.set_from_gicon(tintedGicon);
        return;
    }

    if (iconResult.type === 'file') {
        const exists = iconPaths ? iconPaths.get(iconResult.value) !== false : true;
        image.set_from_gicon(exists
            ? new Gio.FileIcon({file: Gio.File.new_for_path(iconResult.value)})
            : themedIcon('image-missing'));

        return;
    }

    const candidates = buildSymbolicCandidates(iconResult.value, useSymbolic);
    const names = orderThemedNames(candidates, candidates.find(hasThemeIcon));
    image.set_from_gicon(new Gio.ThemedIcon({names, use_default_fallbacks: true}));
}
