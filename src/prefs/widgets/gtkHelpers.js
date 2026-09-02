import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {buildSymbolicCandidates, orderThemedNames, themedIcon, pathOrThemedIcon, probeIconPaths, tintedSymbolicIcon, symbolicTint} from '../../shared/iconLoading.js';
import {fileExists} from '../../shared/asyncIo.js';
import {connectScoped, ruleDispatcher} from '../../shared/lifecycle.js';
import {BOX_SIDES, PREVIEW_STOCK_POPUP_CSS} from '../../const.js';
import {usesAccent} from '../../shared/accentColor.js';
import {COLOR_VARIANT_KEY, colorKeyFor, lightTwin, splitKeyFor} from '../../shared/colorVariant.js';

export function createLabel(text, cssClasses = [], options = {}) {
    const label = new Gtk.Label({
        label: text,
        ...options,
    });
    if (cssClasses.length > 0)
        label.set_css_classes(cssClasses);

    return label;
}

export function createBadge(text, {variant = 'warning'} = {}) {
    ensurePrefsCss();
    const label = new Gtk.Label({
        label: text,
        valign: Gtk.Align.CENTER,
    });
    const classes = ['bti-badge'];
    if (variant !== 'warning')
        classes.push(variant);
    label.set_css_classes(classes);
    return label;
}

export function attachBadge(row, text, {variant = 'warning'} = {}) {
    const label = createBadge(text, {variant});

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
    for (const key of ['halign', 'valign']) {
        if (typeof props[key] === 'string')
            props[key] = _getAlign(props[key]);
    }

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

export function createIconButton(iconName, {circular = true, flat = true, extraClasses = [], ...props} = {}) {
    const classes = [];
    if (flat)
        classes.push('flat');
    if (circular)
        classes.push('circular');
    classes.push(...extraClasses);
    return createButton({iconName, cssClasses: classes, valign: 'center', ...props});
}

// A real toggle, unlike createIconButton which only builds a plain
// Gtk.Button. settings.bind needs an 'active' property to bind to.
export function createBoundToggleButton(settings, key, {iconName = null, tooltip = null} = {}) {
    const btn = new Gtk.ToggleButton({css_classes: ['flat'], valign: Gtk.Align.CENTER});
    if (iconName)
        btn.icon_name = iconName;
    if (tooltip)
        btn.tooltip_text = tooltip;

    settings.bind(key, btn, 'active', Gio.SettingsBindFlags.DEFAULT);
    return btn;
}

export function createLinkToggle(settings, linkKey) {
    const btn = createBoundToggleButton(settings, linkKey);

    const sync = () => {
        btn.icon_name = btn.active ? 'bti-link-symbolic' : 'bti-unlink-symbolic';
        btn.tooltip_text = btn.active
            ? _('Unlink: edit each side on its own')
            : _('Link: editing one side sets all four');
    };
    btn.connect('notify::active', sync);
    sync();

    return btn;
}

export function spacingLinkKey(keyPrefix) {
    return `${keyPrefix}-linked`;
}

const SPACING_KEY_BASES = Object.freeze(['icon', 'toggle', 'overflow-container']);

// One chain toggle per spacing card, padding and margin each their own, so
// margins can be linked while paddings stay free.
const SPACING_LINK_GROUPS = SPACING_KEY_BASES.flatMap(base =>
    ['padding', 'margin'].map(kind => {
        const prefix = `${base}-${kind}`;
        return {linkKey: spacingLinkKey(prefix), prefix};
    }));

// The chain works like the constrain toggle in image editors. While a card
// is linked, editing one side writes the same value to the other three, so
// uniform spacing takes one edit instead of four. Engaging the chain
// changes nothing by itself, values only converge on the next edit.
// Wired once per prefs window, the shell only ever reads the real keys.
export function wireSpacingSync(window, settings) {
    const rules = [];
    for (const group of SPACING_LINK_GROUPS) {
        for (const side of BOX_SIDES) {
            const key = `${group.prefix}-${side}`;
            rules.push({
                match: k => k === key,
                run: () => {
                    if (settings.get_boolean(group.linkKey))
                        _spreadValue(settings, group, key);
                },
            });
        }
    }
    connectScoped(window, settings, 'changed', ruleDispatcher(rules), 'close-request');
}

// The propagated writes re-enter the dispatcher, equal values end the chain.
function _spreadValue(settings, group, sourceKey) {
    const value = settings.get_int(sourceKey);
    for (const side of BOX_SIDES) {
        const key = `${group.prefix}-${side}`;
        if (key !== sourceKey && settings.get_int(key) !== value)
            settings.set_int(key, value);
    }
}

export function createBox(params = {}) {
    const {orientation = 'vertical', spacing = 0, halign, valign, cssClasses = [], ...props} = params;
    const box = new Gtk.Box({spacing, ...props});

    box.set_orientation(orientation === 'horizontal' ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL);
    _withAlign(box, halign, valign);

    if (cssClasses.length)
        box.set_css_classes(cssClasses);
    return box;
}

export function clearChildren(container) {
    let child = container.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        container.remove(child);
        child = next;
    }
}

export function createPicture(params = {}) {
    const {halign, valign, ...props} = params;
    return _withAlign(new Gtk.Picture(props), halign, valign);
}

export function createImage(params = {}) {
    const {halign, valign, ...props} = params;
    return _withAlign(new Gtk.Image(props), halign, valign);
}

export function createAvatar(params = {}) {
    const {size = 32, text = '', showInitials = true, valign, halign, ...props} = params;
    return _withAlign(new Adw.Avatar({
        size,
        text,
        show_initials: showInitials,
        ...props,
    }), halign, valign);
}

// A card per option instead of a dropdown, so each choice can show a small
// preview of what it does.
export function createCardButtonGroup({title = '', description = '', settings, key, options}) {
    ensurePrefsCss();
    const group = new Adw.PreferencesGroup({title, description});

    const box = new Gtk.Box({spacing: 12, homogeneous: true});
    group.add(box);

    const cards = new Map(options.map(option => [option.value, createCard({
        preview: option.preview,
        title: option.label,
        toggle: true,
        extraClasses: ['bti-choice-card'],
        width: -1,
        height: -1,
        valign: 'fill',
    })]));

    let first = null;
    for (const card of cards.values()) {
        if (first)
            card.set_group(first);
        else
            first = card;
        box.append(card);
    }

    const sync = () => cards.get(settings.get_string(key))?.set_active(true);
    sync();

    for (const [value, card] of cards) {
        card.connect('toggled', () => {
            if (card.active && settings.get_string(key) !== value)
                settings.set_string(key, value);
        });
    }
    connectScoped(box, settings, `changed::${key}`, sync);

    return group;
}

export function createCard({
    avatar = null,
    iconName = null,
    iconSize = 40,
    preview = null,
    title = '',
    subtitle = '',
    onActivate = null,
    tooltip = null,
    toggle = false,
    extraClasses = [],
    width = 110,
    height = 130,
    valign = 'center',
} = {}) {
    const ButtonClass = toggle ? Gtk.ToggleButton : Gtk.Button;
    const button = new ButtonClass({
        css_classes: ['card', 'flat', ...extraClasses],
        width_request: width,
        height_request: height,
        valign: _getAlign(valign),
        // Without this, the preview's own vexpand below computes upward
        // through the button (GTK expands a parent whose child expands
        // unless told otherwise), inflating the whole card to fill
        // whatever vertical room the page happens to have.
        vexpand: false,
    });

    if (tooltip)
        button.tooltip_text = tooltip;

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_top: 10,
        margin_bottom: 6,
        margin_start: 8,
        margin_end: 8,
        // FILL instead of CENTER, so the caption sits at a fixed distance
        // from the bottom edge. Cards whose preview content is taller (a
        // two-row icon grid vs. one row) would otherwise push the whole
        // group's center down, leaving captions across cards unaligned.
        valign: Gtk.Align.FILL,
        halign: Gtk.Align.CENTER,
    });

    let topWidget = avatar ?? preview;
    if (!topWidget && iconName) {
        topWidget = new Gtk.Image({
            icon_name: iconName,
            pixel_size: iconSize,
        });
    }
    if (topWidget) {
        topWidget.set_halign(Gtk.Align.CENTER);
        topWidget.set_valign(Gtk.Align.CENTER);
        topWidget.set_vexpand(true);
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
        loader.write(bytes.get_data ? bytes.get_data() : bytes);
        loader.close();
        return Gdk.Texture.new_for_pixbuf(loader.get_pixbuf());
    } catch (e) {
        error(`Failed to create texture: ${e.message}`);
        return null;
    }
}

// While the accent drives a color the swatch just previews the live accent,
// the stored value is left alone so it comes back on toggle-off. read and
// write are callbacks because the value can live in GSettings or in a
// per-app blob field.
export function createColorSwatch(dialogTitle, {read, write, usingAccent = null}) {
    const button = new Gtk.ColorDialogButton({
        valign: Gtk.Align.CENTER,
        dialog: new Gtk.ColorDialog({title: dialogTitle}),
    });

    let syncing = false;
    const sync = () => {
        syncing = true;
        if (usingAccent?.()) {
            button.set_rgba(Adw.StyleManager.get_default().get_accent_color_rgba());
        } else {
            const rgba = new Gdk.RGBA();
            if (!rgba.parse(read()))
                rgba.parse('rgba(0,0,0,1)');
            button.set_rgba(rgba);
        }
        syncing = false;
    };
    sync();

    // Skip our own set_rgba and the accent preview, only real picks persist.
    button.connect('notify::rgba', () => {
        if (syncing || usingAccent?.())
            return;
        write(button.get_rgba().to_string());
    });
    if (usingAccent)
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

export function createColorButton(settings, key, dialogTitle = '') {
    const {button, sync} = createColorSwatch(dialogTitle, {
        read: () => settings.get_string(editedColorKey(settings, key)),
        write: value => settings.set_string(editedColorKey(settings, key), value),
        usingAccent: () => editedColorUsesAccent(settings, key),
    });
    watchColorKey(button, settings, key, sync);
    return button;
}

export function createFileFilter(name, patterns = [], mimeTypes = []) {
    const filter = new Gtk.FileFilter();
    filter.set_name(name);
    patterns.forEach(p => filter.add_pattern(p));
    mimeTypes.forEach(m => filter.add_mime_type(m));
    return filter;
}

// Past the raster sizes a symbolic icon ships in, where the scalable directory
// is the only zero-distance match (gtkicontheme.c compare_dir_size_matches).
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

    // Only a caller that names its own tint wants one applied here, so a preview
    // bound to a different color key keeps its own.
    if (!value.startsWith('/')) {
        if (!options.tint) {
            image.set_from_gicon(pathOrThemedIcon(value));
            return;
        }
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

// Adw resolves the accent on the prefs side, St does it from a theme node.
export function prefsSymbolicTint(settings) {
    return symbolicTint(settings, {
        accent: Adw.StyleManager.get_default().get_accent_color_rgba().to_string(),
        light: editsLightSet(settings),
    });
}

// libadwaita's window_fg_color, measured off a realized widget. It is the
// color the tab labels and their icons are drawn in.
const PREFS_FG_DARK = '#ffffff';
const PREFS_FG_LIGHT = 'rgba(0,0,6,0.8)';

// A widget cannot answer this before it is in a window. An unparented
// Gtk.Image reports white in either scheme, which would paint light-mode
// icons invisible.
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

// No themed icon first and a swap when the bytes land. GTK draws nothing at
// all for some app logos, measured with slack-symbolic and devpod-symbolic
// in MoreWaita.
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
// image-missing. A freshly picked icon is not in the probed map, and it
// can sit on a network mount, so file results are probed off the render path.
export function applyIconPreview(imageWidget, iconResult, settings) {
    const useSymbolic = settings.get_boolean('enable-symbolic-icons');
    const value = iconResult?.value;
    if (iconResult?.type !== 'file') {
        // A name has no file to probe, but it can still be a colored icon the
        // toolkit would flatten.
        applyResolvedIcon(imageWidget, iconResult, useSymbolic);
        applyTintedIcon(imageWidget, value, settings);
        return;
    }
    imageWidget._btiPendingIcon = value;
    Promise.all([
        probeIconPaths([{custom_icon: value}]),
        _tintedFor(value, settings, imageWidget),
    ]).then(([paths, tinted]) => {
        if (imageWidget._btiPendingIcon === value)
            applyResolvedIcon(imageWidget, iconResult, useSymbolic, paths, tinted);
    });
}

export function applyResolvedIcon(image, iconResult, useSymbolic = false, iconPaths = null, tintedGicon = null) {
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

// One static sheet for every custom prefs widget. Per-instance dynamic
// styles (the live previews) bring their own providers instead.
let _prefsCssLoaded = false;
export function ensurePrefsCss() {
    if (_prefsCssLoaded)
        return;
    const display = Gdk.Display.get_default();
    const provider = new Gtk.CssProvider();
    // The thumbnail rule is appended here because it shares its look with the
    // live preview through PREVIEW_STOCK_POPUP_CSS instead of duplicating the values.
    const sheet = Gio.File.new_for_uri(import.meta.url)
        .get_parent().get_parent().get_child('stylesheet.css');
    const [, bytes] = sheet.load_contents(null);
    provider.load_from_string(`${new TextDecoder().decode(bytes)}
        .bti-thumbnail-popup { ${PREVIEW_STOCK_POPUP_CSS} color: white; }`);
    Gtk.StyleContext.add_provider_for_display(
        display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );
    _prefsCssLoaded = true;
}

// The align pair takes strings here, so it cannot go through the constructor
// props like everything else.
function _withAlign(widget, halign, valign) {
    if (halign)
        widget.set_halign(_getAlign(halign));
    if (valign)
        widget.set_valign(_getAlign(valign));
    return widget;
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
