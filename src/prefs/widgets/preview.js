import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';
import {ensurePrefsCss, clearChildren, editedColorKey, editsLightSet} from './gtkHelpers.js';
import {boxGeometryCss, borderShorthand} from '../../shared/boxStyle.js';
import {usesAccent} from '../../shared/accentColor.js';
import {COLOR_VARIANT_KEY} from '../../shared/colorVariant.js';
import {
    DEFAULT_PILL_RADIUS_PX, DEFAULT_ICON_PADDING_PX, ICON_MARGIN_PX, ITEM_SPACING_PX,
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

// The default backdrop is dark. Editing the Light set swaps in a light one,
// so the colors are always seen against their own background.
const PREVIEW_LIGHT_BACKDROP_CSS =
    'background-image: linear-gradient(160deg, alpha(@accent_bg_color, 0.30), alpha(white, 0) 55%),' +
    ' linear-gradient(160deg, #fdfdfe, #c6c6cf);' +
    ' box-shadow: inset 0 1px 0 alpha(white, 0.8);';

const PREVIEW_STOCK_POPUP_LIGHT_CSS =
    `background-color: #fafafb; border-radius: 14px; padding: 8px; ${PREVIEW_ELEMENT_SHADOW_CSS}`;

// Rebuilding on every watched change instead of diffing widgets keeps
// the preview from ever drifting, the cost is a handful of images.
export function createPreviewGroup(settings, {watch, render, splitKey}) {
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
    backdrop.add_css_class(scopeClass);
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
        const backdropCss = _editsLightFor(settings, splitKey)
            ? ` .bti-preview-backdrop.${scopeClass} { ${PREVIEW_LIGHT_BACKDROP_CSS} }`
            : '';
        provider.load_from_string(css + backdropCss);
    };

    // The accent keys resolve through the system accent, which can change
    // while the page is open.
    connectScoped(group, Adw.StyleManager.get_default(), 'notify::accent-color', apply);
    [...watch, COLOR_VARIANT_KEY]
        .forEach(key => connectScoped(group, settings, `changed::${key}`, apply));
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

// The box math is shared with the shell through boxStyle.js. Only the color
// lookup differs, St resolves its own accent keyword and GTK cannot, so the
// accent turns into a literal color here.
function _trayIconCss(settings, scopeClass, {hover = false} = {}) {
    if (!settings.get_boolean('enable-custom-icon-style'))
        return `.${scopeClass}-icon { ${_stockIconStyle(settings, 'icon-color-split')} margin: 0 ${ICON_MARGIN_PX}px; }`;
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
        const color = _resolveColor(settings, 'toggle-icon-color');
        const bg = _resolveColor(settings, 'toggle-icon-background-color');
        const geometry = boxGeometryCss(settings, {spacingPrefix: 'toggle', radiusPrefix: 'toggle-icon'});
        return `${sel} { ${geometry}` +
            `${_cssDeclaration('color', color || 'white')}${_backgroundStyle(bg)}${_borderStyle(settings, 'toggle-icon')} }` +
            ` ${sel}:hover { ${_hoverStyle(settings, 'toggle-icon')} }`;
    }

    // Stock mode styles the toggle like a stock tray chip, close enough to
    // the shell theme's panel-button for a preview.
    return `${sel} { ${_stockIconStyle(settings, 'toggle-icon-color-split')} }`;
}

function _stockIconStyle(settings, splitKey) {
    const color = _editsLightFor(settings, splitKey) ? '#222226' : 'white';
    return `padding: ${DEFAULT_ICON_PADDING_PX}px; border-radius: ${DEFAULT_PILL_RADIUS_PX}px; color: ${color};`;
}

// Split off means one set only, and that one belongs to the dark chrome.
function _editsLightFor(settings, splitKey) {
    return settings.get_boolean(splitKey) && editsLightSet(settings);
}

function _customIconStyle(settings) {
    const color = _resolveColor(settings, 'icon-color');
    const bg = _resolveColor(settings, 'icon-background-color');
    return `${boxGeometryCss(settings, {spacingPrefix: 'icon'})}` +
        `${_cssDeclaration('color', color || 'white')}${_backgroundStyle(bg)}${_borderStyle(settings, 'icon')}`;
}

function _hoverStyle(settings, prefix) {
    const color = _resolveColor(settings, `${prefix}-hover-color`);
    const bg = _resolveColor(settings, `${prefix}-hover-background-color`);
    const border = _resolveColor(settings, `${prefix}-hover-border-color`);
    return `${_cssDeclaration('color', color)}${_backgroundStyle(bg)}${_cssDeclaration('border-color', border)}`;
}

function _popupCss(settings, scopeClass) {
    if (!settings.get_boolean('enable-custom-overflow-style')) {
        const stock = _editsLightFor(settings, 'overflow-container-color-split') ? PREVIEW_STOCK_POPUP_LIGHT_CSS : PREVIEW_STOCK_POPUP_CSS;
        return `.${scopeClass}-popup { ${stock} }`;
    }

    const bg = _resolveColor(settings, 'overflow-container-background-color');
    return `.${scopeClass}-popup { ${boxGeometryCss(settings, {spacingPrefix: 'overflow-container'})}` +
        `${_backgroundStyle(bg)}${_borderStyle(settings, 'overflow-container')} }`;
}

function _borderStyle(settings, prefix) {
    const border = borderShorthand(settings, prefix, key => _resolveColor(settings, key));
    return border === '0px' ? '' : ` border: ${border};`;
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

function _resolveColor(settings, colorKey) {
    const value = settings.get_string(editedColorKey(settings, colorKey));
    return usesAccent(value)
        ? Adw.StyleManager.get_default().get_accent_color_rgba().to_string()
        : value;
}
