import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';

import {error} from '../../shared/logging.js';
import {buildSymbolicCandidates, themedIconWithFallback} from '../../shared/icon.js';
import {connectScoped} from '../../shared/lifecycle.js';

export function createLabel(text, cssClasses = [], options = {}) {
    const label = new Gtk.Label({
        label: text,
        ...options,
    });
    if (cssClasses && cssClasses.length > 0)
        label.set_css_classes(cssClasses);

    return label;
}

export function attachBadge(row, text, {variant = 'warning'} = {}) {
    _ensureBadgeCss();
    const label = new Gtk.Label({
        label: text,
        valign: Gtk.Align.CENTER,
    });
    const classes = ['bti-badge'];
    if (variant !== 'warning')
        classes.push(variant);
    label.set_css_classes(classes);

    const actionWidget = row.get_activatable_widget?.();
    if (actionWidget) {
        row.remove(actionWidget);
        row.add_suffix(label);
        row.add_suffix(actionWidget);
        row.set_activatable_widget(actionWidget);
    } else {
        row.add_suffix(label);
    }
    return label;
}

export function createButton({label, iconName, cssClasses = [], callback, ...props}) {
    const params = {valign: Gtk.Align.CENTER, ...props};
    if (label !== undefined)
        params.label = label;
    if (iconName !== undefined)
        params.icon_name = iconName;
    const btn = new Gtk.Button(params);
    if (cssClasses.length > 0)
        btn.set_css_classes(cssClasses);
    if (callback)
        btn.connect('clicked', callback);
    return btn;
}

// Flat + circular defaults to match the reset/sync buttons.
export function createIconButton(iconName, {circular = true, flat = true, extraClasses = [], ...props} = {}) {
    const classes = [];
    if (flat)
        classes.push('flat');
    if (circular)
        classes.push('circular');
    classes.push(...extraClasses);
    return createButton({iconName, cssClasses: classes, valign: 'center', ...props});
}

export function createBox(params = {}) {
    const {orientation = 'vertical', spacing = 0, halign, valign, cssClasses = [], ...props} = params;
    const box = new Gtk.Box({spacing, ...props});

    box.set_orientation(orientation === 'horizontal' ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL);

    if (halign)
        box.set_halign(_getAlign(halign));
    if (valign)
        box.set_valign(_getAlign(valign));

    if (cssClasses.length)
        box.set_css_classes(cssClasses);
    return box;
}

export function createPicture(params = {}) {
    const {halign, valign, ...props} = params;
    const pic = new Gtk.Picture(props);
    if (halign)
        pic.set_halign(_getAlign(halign));
    if (valign)
        pic.set_valign(_getAlign(valign));
    return pic;
}

export function createImage(params = {}) {
    const {halign, valign, ...props} = params;
    const image = new Gtk.Image(props);
    if (halign)
        image.set_halign(_getAlign(halign));
    if (valign)
        image.set_valign(_getAlign(valign));
    return image;
}

export function createStringList(strings = []) {
    return new Gtk.StringList({strings});
}

export function createAdjustment(params = {}) {
    return new Gtk.Adjustment(params);
}

export function createAvatar(params = {}) {
    const {size = 32, text = '', showInitials = true, valign, halign, ...props} = params;
    const avatar = new Adw.Avatar({
        size,
        text,
        show_initials: showInitials,
        ...props,
    });
    if (valign)
        avatar.set_valign(_getAlign(valign));
    if (halign)
        avatar.set_halign(_getAlign(halign));
    return avatar;
}

export function createCard({
    avatar = null,
    iconName = null,
    iconSize = 40,
    title = '',
    subtitle = '',
    onActivate = null,
    tooltip = null,
    width = 110,
    height = 130,
} = {}) {
    const button = new Gtk.Button({
        css_classes: ['card', 'flat'],
        width_request: width,
        height_request: height,
        valign: Gtk.Align.CENTER,
    });

    if (tooltip)
        button.tooltip_text = tooltip;

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 8,
        margin_end: 8,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
    });

    let topWidget = avatar;
    if (!topWidget && iconName) {
        topWidget = new Gtk.Image({
            icon_name: iconName,
            pixel_size: iconSize,
            halign: Gtk.Align.CENTER,
        });
    }
    if (topWidget) {
        topWidget.set_halign(Gtk.Align.CENTER);
        box.append(topWidget);
    }

    if (title) {
        box.append(new Gtk.Label({
            label: title,
            ellipsize: Pango.EllipsizeMode.END,
            max_width_chars: 12,
            halign: Gtk.Align.CENTER,
            css_classes: ['caption-heading'],
        }));
    }

    if (subtitle) {
        box.append(new Gtk.Label({
            label: subtitle,
            ellipsize: Pango.EllipsizeMode.END,
            max_width_chars: 14,
            halign: Gtk.Align.CENTER,
            css_classes: ['caption', 'dim-label'],
        }));
    }

    button.set_child(box);

    if (onActivate)
        button.connect('clicked', onActivate);

    return button;
}

// Adw.WrapBox flows cards into the next line once the row's width runs out,
// rather than gaining a horizontal scrollbar.
export function createCardRow(cards = [], {spacing = 12, margin = 4} = {}) {
    const wrap = new Adw.WrapBox({
        child_spacing: spacing,
        line_spacing: spacing,
        align: 0.5,
        margin_top: margin,
        margin_bottom: margin,
        margin_start: margin,
        margin_end: margin,
    });
    cards.forEach(c => wrap.append(c));
    return wrap;
}

// PixbufLoader.write throws on malformed bytes (e.g. truncated avatar).
export function createTextureFromBytes(bytes) {
    try {
        const loader = new GdkPixbuf.PixbufLoader();
        loader.write(bytes.get_data());
        loader.close();
        return Gdk.Texture.new_for_pixbuf(loader.get_pixbuf());
    } catch (e) {
        error(`Failed to create texture: ${e.message}`);
        return null;
    }
}

export function createColorButton(settings, key, dialogTitle = '') {
    const button = new Gtk.ColorDialogButton({
        valign: Gtk.Align.CENTER,
        dialog: new Gtk.ColorDialog({title: dialogTitle}),
    });

    const sync = () => {
        const rgba = new Gdk.RGBA();
        if (!rgba.parse(settings.get_string(key)))
            rgba.parse('rgba(0,0,0,1)');
        button.set_rgba(rgba);
    };
    sync();

    button.connect('notify::rgba', () => settings.set_string(key, button.get_rgba().to_string()));
    connectScoped(button, settings, `changed::${key}`, sync);

    return button;
}

export function createFileFilter(name, patterns = [], mimeTypes = []) {
    const filter = new Gtk.FileFilter();
    if (name)
        filter.set_name(name);
    if (patterns)
        patterns.forEach(p => filter.add_pattern(p));
    if (mimeTypes)
        mimeTypes.forEach(m => filter.add_mime_type(m));
    return filter;
}

// Mirrors the ThemedIcon-with-fallback chain that resolveTrayIcon uses in
// the shell, so prefs and live tray render the same icon for the same input.
export function applyResolvedIcon(image, iconResult, useSymbolic = false) {
    if (!image || !iconResult) {
        if (image)
            image.clear();
        return;
    }

    if (iconResult.type === 'file') {
        const file = Gio.File.new_for_path(iconResult.value);
        if (file.query_exists(null))
            image.set_from_gicon(new Gio.FileIcon({file}));
        else
            image.set_from_gicon(themedIconWithFallback('image-missing'));

        return;
    }

    const name = iconResult.value;
    if (!name) {
        image.set_from_gicon(themedIconWithFallback('image-missing'));
        return;
    }

    const names = [...buildSymbolicCandidates(name, useSymbolic), 'image-missing'];
    image.set_from_gicon(new Gio.ThemedIcon({names, use_default_fallbacks: true}));
}

// Pill-shaped tag. The `.bti-` prefix prevents clashes with Adwaita.
let _badgeCssLoaded = false;
function _ensureBadgeCss() {
    if (_badgeCssLoaded)
        return;
    const display = Gdk.Display.get_default();
    if (!display)
        return;
    const provider = new Gtk.CssProvider();
    const css = `
        .bti-badge {
            padding: 1px 8px;
            border-radius: 999px;
            font-size: 0.78em;
            font-weight: bold;
            background-color: alpha(@warning_color, 0.18);
            color: @warning_color;
        }
        .bti-badge.info {
            background-color: alpha(@accent_color, 0.18);
            color: @accent_color;
        }
    `;
    provider.load_from_string(css);
    Gtk.StyleContext.add_provider_for_display(
        display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );
    _badgeCssLoaded = true;
}

function _getAlign(str) {
    switch (str) {
    case 'center': return Gtk.Align.CENTER;
    case 'start': return Gtk.Align.START;
    case 'end': return Gtk.Align.END;
    case 'fill':
    default: return Gtk.Align.FILL;
    }
}
