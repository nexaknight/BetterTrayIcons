import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

export const ALIGN_PROPS = Object.freeze(['halign', 'valign']);

export function createLabel(text, cssClasses = [], options = {}) {
    const label = new Gtk.Label({
        label: text,
        ...options,
    });
    if (cssClasses.length > 0)
        label.set_css_classes(cssClasses);

    return label;
}

export function createBox(params = {}) {
    const {orientation = 'vertical', spacing = 0, halign, valign, cssClasses = [], ...props} = params;
    const box = new Gtk.Box({spacing, ...props});

    box.set_orientation(orientation === 'horizontal' ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL);
    withAlign(box, halign, valign);

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

export function withAlign(widget, halign, valign) {
    if (halign)
        widget.set_halign(alignFor(halign));
    if (valign)
        widget.set_valign(alignFor(valign));
    return widget;
}

export function alignFor(name) {
    switch (name) {
    case 'center': return Gtk.Align.CENTER;
    case 'start': return Gtk.Align.START;
    case 'end': return Gtk.Align.END;
    case 'fill':
    default: return Gtk.Align.FILL;
    }
}

let _prefsCssLoaded = false;

export function ensurePrefsCss() {
    if (_prefsCssLoaded)
        return;
    const display = Gdk.Display.get_default();
    const provider = new Gtk.CssProvider();
    const sheet = Gio.File.new_for_uri(import.meta.url)
        .get_parent().get_parent().get_child('stylesheet.css');
    const [, bytes] = sheet.load_contents(null);
    provider.load_from_string(new TextDecoder().decode(bytes));
    Gtk.StyleContext.add_provider_for_display(
        display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );
    _prefsCssLoaded = true;
}
