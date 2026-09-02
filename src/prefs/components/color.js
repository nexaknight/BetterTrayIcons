import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';

import {connectScoped} from '../../shared/lifecycle.js';
import {usesAccent} from '../../shared/accentColor.js';
import {COLOR_VARIANT_KEY, colorKeyFor, lightTwin, splitKeyFor} from '../../shared/colorVariant.js';

const SWATCH_FALLBACK_COLOR = 'rgba(0,0,0,1)';

// While the accent drives a color the swatch just previews the live accent,
// the stored value is left alone so it comes back on toggle-off.
export function createColorSwatch({title, read, write, usingAccent}) {
    const button = new Gtk.ColorDialogButton({
        valign: Gtk.Align.CENTER,
        dialog: new Gtk.ColorDialog({title}),
    });

    let isSyncing = false;
    const sync = () => {
        isSyncing = true;
        if (usingAccent()) {
            button.set_rgba(Adw.StyleManager.get_default().get_accent_color_rgba());
        } else {
            const rgba = new Gdk.RGBA();
            if (!rgba.parse(read()))
                rgba.parse(SWATCH_FALLBACK_COLOR);
            button.set_rgba(rgba);
        }
        isSyncing = false;
    };
    sync();

    button.connect('notify::rgba', () => {
        if (isSyncing || usingAccent())
            return;
        write(button.get_rgba().to_string());
    });
    connectScoped(button, Adw.StyleManager.get_default(), 'notify::accent-color', sync);

    return {button, sync};
}

export function editedColorKey(settings, key) {
    return colorKeyFor(settings, key, editsLightSet(settings));
}

export function editsLightSet(settings) {
    return settings.get_string(COLOR_VARIANT_KEY) === 'light';
}

export function editedColorUsesAccent(settings, key) {
    return usesAccent(settings.get_string(editedColorKey(settings, key)));
}

export function watchColorKey(owner, settings, key, sync) {
    [key, lightTwin(key), COLOR_VARIANT_KEY, splitKeyFor(key)]
        .forEach(watched => connectScoped(owner, settings, `changed::${watched}`, sync));
}

export function createColorButton(settings, key, dialogTitle) {
    const {button, sync} = createColorSwatch({
        title: dialogTitle,
        read: () => settings.get_string(editedColorKey(settings, key)),
        write: value => settings.set_string(editedColorKey(settings, key), value),
        usingAccent: () => editedColorUsesAccent(settings, key),
    });
    watchColorKey(button, settings, key, sync);
    return button;
}
