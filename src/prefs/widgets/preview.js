import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {warn} from '../../shared/logging.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {ensurePrefsCss, clearChildren} from './gtkHelpers.js';
import {
    BOX_SIDES, DEFAULT_PILL_RADIUS_PX, DEFAULT_ICON_PADDING_PX, ICON_MARGIN_PX, ITEM_SPACING_PX,
    PREVIEW_ELEMENT_SHADOW_CSS, PREVIEW_STOCK_POPUP_CSS,
} from '../../const.js';

// Stand-ins for typical tray applications in the live previews, bundled so
// they render the same under every icon theme.
const PREVIEW_SAMPLE_ICONS = Object.freeze([
    'bti-sample-chat-symbolic',
    'bti-sample-music-symbolic',
    'bti-sample-game-symbolic',
    'bti-sample-mail-symbolic',
    'bti-sample-camera-symbolic',
    'bti-sample-browser-symbolic',
    'bti-sample-vault-symbolic',
    'bti-sample-terminal-symbolic',
]);

let _instanceSeq = 0;

// Rebuilding on every watched change instead of diffing widgets keeps
// the preview from ever drifting, the cost is a handful of images.
export function createPreviewGroup(settings, {watch, render}) {
    ensurePrefsCss();
    const group = new Adw.PreferencesGroup();

    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        css_classes: ['card', 'bti-preview-card'],
    });
    card.append(new Gtk.Label({
        label: _('Live Preview'),
        halign: Gtk.Align.START,
        css_classes: ['caption-heading', 'dim-label'],
    }));
    const backdrop = new Gtk.Box({css_classes: ['bti-preview-backdrop']});
    card.append(backdrop);
    group.add(card);

    // Class names are display-global, every preview instance styles its own.
    const scopeClass = `bti-preview-${_instanceSeq++}`;
    const provider = new Gtk.CssProvider();
    const display = Gdk.Display.get_default();
    // Cleanup rides unrealize, not destroy: destroy waits on the GC in GJS
    // and measurably never fired here, leaking one display-global provider
    // per subpage visit in the shared prefs service.
    let attached = false;
    const attach = () => {
        if (attached)
            return;
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        attached = true;
    };
    attach();
    group.connect('realize', attach);
    group.connect('unrealize', () => {
        if (!attached)
            return;
        Gtk.StyleContext.remove_provider_for_display(display, provider);
        attached = false;
    });

    const apply = () => {
        const {widget, css} = render(settings, scopeClass);
        widget.halign = Gtk.Align.CENTER;
        widget.hexpand = true;
        clearChildren(backdrop);
        backdrop.append(widget);
        try {
            provider.load_from_string(css);
        } catch (e) {
            warn(`preview: bad css: ${e.message}`);
        }
    };

    // The accent keys resolve through the system accent, which can change
    // while the page is open.
    connectScoped(group, Adw.StyleManager.get_default(), 'notify::accent-color', apply);
    watch.forEach(key => connectScoped(group, settings, `changed::${key}`, apply));
    apply();

    return group;
}

export function buildTrayPreview(settings, scopeClass) {
    const box = new Gtk.Box();
    const size = settings.get_int('icon-size');
    PREVIEW_SAMPLE_ICONS.slice(0, 4).forEach(name => box.append(_createSampleIcon(name, size, scopeClass)));
    return {widget: box, css: _trayIconCss(settings, scopeClass, {hover: true})};
}

export function buildTogglePreview(settings, scopeClass) {
    const box = new Gtk.Box();
    const toggle = new Gtk.Image({
        icon_name: settings.get_string('toggle-icon-name'),
        pixel_size: settings.get_int('toggle-icon-size'),
        css_classes: [`${scopeClass}-toggle`],
    });
    const size = settings.get_int('icon-size');
    const icons = PREVIEW_SAMPLE_ICONS.slice(0, 2).map(name => _createSampleIcon(name, size, scopeClass));

    const parts = settings.get_string('toggle-position') === 'left'
        ? [toggle, ...icons] : [...icons, toggle];
    parts.forEach(part => box.append(part));

    return {widget: box, css: _trayIconCss(settings, scopeClass) + _toggleCss(settings, scopeClass)};
}

export function buildOverflowPreview(settings, scopeClass) {
    const size = settings.get_int('icon-size');
    let inner;
    if (settings.get_string('overflow-layout-mode') === 'grid') {
        const cols = settings.get_int('grid-column-limit');
        inner = new Gtk.Grid({row_spacing: ITEM_SPACING_PX, column_spacing: ITEM_SPACING_PX});
        PREVIEW_SAMPLE_ICONS.forEach((name, i) =>
            inner.attach(_createSampleIcon(name, size, scopeClass), i % cols, Math.floor(i / cols), 1, 1));
    } else {
        inner = new Gtk.Box({spacing: ITEM_SPACING_PX});
        PREVIEW_SAMPLE_ICONS.forEach(name => inner.append(_createSampleIcon(name, size, scopeClass)));
    }

    const popup = new Gtk.Box({css_classes: [`${scopeClass}-popup`]});
    popup.append(inner);
    return {widget: popup, css: _trayIconCss(settings, scopeClass, {hover: true}) + _popupCss(settings, scopeClass)};
}

// Drawn on a popup-shaped backdrop since the layout applies to the
// overflow popup.
export function buildLayoutThumbnail(mode) {
    ensurePrefsCss();
    const names = PREVIEW_SAMPLE_ICONS.slice(0, 4);
    let inner;
    if (mode === 'row') {
        inner = new Gtk.Box({spacing: 6});
        names.forEach(name => inner.append(new Gtk.Image({icon_name: name, pixel_size: 14})));
    } else {
        inner = new Gtk.Grid({row_spacing: 6, column_spacing: 6});
        names.forEach((name, i) =>
            inner.attach(new Gtk.Image({icon_name: name, pixel_size: 14}), i % 2, Math.floor(i / 2), 1, 1));
    }
    const popup = new Gtk.Box({css_classes: ['bti-thumbnail-popup'], halign: Gtk.Align.CENTER});
    popup.append(inner);
    return popup;
}

function _createSampleIcon(iconName, size, scopeClass) {
    return new Gtk.Image({icon_name: iconName, pixel_size: size, css_classes: [`${scopeClass}-icon`]});
}

// The shell computes the same styles in computeTrayIconStyle and
// computeToggleStyle (src/shell/utils/actor.js). That module needs St, and
// its -st-accent-color keyword only St resolves, so the preview redoes the
// math against GTK's accent. Keep both in sync when a style key changes.
function _trayIconCss(settings, scopeClass, {hover = false} = {}) {
    if (!settings.get_boolean('enable-custom-icon-style'))
        return `.${scopeClass}-icon { ${_stockIconStyle()} margin: 0 ${ICON_MARGIN_PX}px; }`;
    const base = `.${scopeClass}-icon { ${_customIconStyle(settings)} }`;
    return hover
        ? `${base} .${scopeClass}-icon:hover { ${_hoverStyle(settings, 'icon')} }`
        : base;
}

function _toggleCss(settings, scopeClass) {
    const sel = `.${scopeClass}-toggle`;
    const custom = settings.get_boolean('enable-custom-toggle-style');
    const inherit = custom &&
        settings.get_boolean('toggle-inherit-icon-style') &&
        settings.get_boolean('enable-custom-icon-style');

    if (inherit) {
        return `${sel} { ${_customIconStyle(settings)} }` +
            ` ${sel}:hover { ${_hoverStyle(settings, 'icon')} }`;
    }

    if (custom) {
        const color = _accentAwareColor(settings, 'toggle-icon-color', 'toggle-icon-use-accent-color');
        const bg = _accentAwareColor(settings, 'toggle-icon-background-color', 'toggle-icon-background-use-accent-color');
        return `${sel} { padding: ${_sidesShorthand(settings, 'toggle-padding')};` +
            ` margin: ${_sidesShorthand(settings, 'toggle-margin')};` +
            ` border-radius: ${settings.get_int('toggle-icon-border-radius')}px;` +
            `${_cssDeclaration('color', color || 'white')}${_backgroundStyle(bg)}${_borderStyle(settings, 'toggle-icon')} }` +
            ` ${sel}:hover { ${_hoverStyle(settings, 'toggle-icon')} }`;
    }

    // Stock mode styles the toggle like a stock tray chip, close enough to
    // the shell theme's panel-button for a preview.
    return `${sel} { ${_stockIconStyle()} }`;
}

function _stockIconStyle() {
    return `padding: ${DEFAULT_ICON_PADDING_PX}px; border-radius: ${DEFAULT_PILL_RADIUS_PX}px; color: white;`;
}

function _customIconStyle(settings) {
    const color = _accentAwareColor(settings, 'icon-color', 'icon-use-accent-color');
    const bg = _accentAwareColor(settings, 'icon-background-color', 'icon-background-use-accent-color');
    return `padding: ${_sidesShorthand(settings, 'icon-padding')};` +
        ` margin: ${_sidesShorthand(settings, 'icon-margin')};` +
        ` border-radius: ${settings.get_int('icon-border-radius')}px;` +
        `${_cssDeclaration('color', color || 'white')}${_backgroundStyle(bg)}${_borderStyle(settings, 'icon')}`;
}

function _hoverStyle(settings, prefix) {
    const color = _accentAwareColor(settings, `${prefix}-hover-color`, `${prefix}-hover-use-accent-color`);
    const bg = _accentAwareColor(settings, `${prefix}-hover-background-color`, `${prefix}-hover-background-use-accent-color`);
    const border = _accentAwareColor(settings, `${prefix}-hover-border-color`, `${prefix}-hover-border-use-accent-color`);
    return `${_cssDeclaration('color', color)}${_backgroundStyle(bg)}${_cssDeclaration('border-color', border)}`;
}

function _popupCss(settings, scopeClass) {
    if (!settings.get_boolean('enable-custom-overflow-style'))
        return `.${scopeClass}-popup { ${PREVIEW_STOCK_POPUP_CSS} }`;

    const bg = _accentAwareColor(settings, 'overflow-container-background-color',
        'overflow-container-background-use-accent-color');
    return `.${scopeClass}-popup { padding: ${_sidesShorthand(settings, 'overflow-container-padding')};` +
        ` margin: ${_sidesShorthand(settings, 'overflow-container-margin')};` +
        ` border-radius: ${settings.get_int('overflow-container-border-radius')}px;` +
        `${_backgroundStyle(bg)}${_borderStyle(settings, 'overflow-container')} }`;
}

function _borderStyle(settings, prefix) {
    const color = _accentAwareColor(settings, `${prefix}-border-color`, `${prefix}-border-use-accent-color`);
    return _cssDeclaration('border',
        color ? `${settings.get_int(`${prefix}-border-width`)}px solid ${color}` : '');
}

function _sidesShorthand(settings, keyPrefix) {
    return BOX_SIDES.map(side => `${settings.get_int(`${keyPrefix}-${side}`)}px`).join(' ');
}

// An empty declaration would fail the whole sheet, so absent values vanish.
function _cssDeclaration(prop, value) {
    return value ? ` ${prop}: ${value};` : '';
}

// The drop shadow only makes sense under a fill the eye can see, on a
// transparent element it would draw a floating silhouette.
function _backgroundStyle(bg) {
    const rgba = new Gdk.RGBA();
    const visible = !!bg && rgba.parse(bg) && rgba.alpha > 0;
    return _cssDeclaration('background-color', bg) + (visible ? ` ${PREVIEW_ELEMENT_SHADOW_CSS}` : '');
}

function _accentAwareColor(settings, colorKey, accentKey) {
    if (settings.get_boolean(accentKey))
        return Adw.StyleManager.get_default().get_accent_color_rgba().to_string();
    return settings.get_string(colorKey);
}
