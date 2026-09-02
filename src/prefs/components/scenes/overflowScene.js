import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

import {boxGeometryCss} from '../../../shared/boxStyle.js';
import {THEME_FOREGROUND, backgroundIsLight} from '../../../shared/colorContrast.js';
import {ITEM_SPACING_PX} from '../../../const.js';
import {spacingGuides} from '../guide.js';
import {
    PREVIEW_SAMPLE_ICONS,
    backgroundStyle, borderStyle, createSampleIcon, editsLightFor, resolveColor, trayIconCss,
} from './sceneInk.js';

export function buildOverflowPreview(settings, scopeClass) {
    const size = settings.get_int('icon-size');
    let inner;
    if (settings.get_string('overflow-layout-mode') === 'grid') {
        const columns = settings.get_int('grid-column-limit');
        inner = new Gtk.Grid({row_spacing: ITEM_SPACING_PX, column_spacing: ITEM_SPACING_PX});
        PREVIEW_SAMPLE_ICONS.forEach((name, i) =>
            inner.attach(createSampleIcon(name, size, scopeClass), i % columns, Math.floor(i / columns), 1, 1));
    } else {
        inner = new Gtk.Box({spacing: ITEM_SPACING_PX});
        PREVIEW_SAMPLE_ICONS.forEach(name => inner.append(createSampleIcon(name, size, scopeClass)));
    }

    const popup = new Gtk.Box({css_classes: [`${scopeClass}-popup`]});
    popup.append(inner);
    const isCustom = settings.get_boolean('enable-custom-overflow-style');
    if (!isCustom) {
        popup.add_css_class('bti-stock-popup');
        if (editsLightFor(settings, 'overflow-container-color-split'))
            popup.add_css_class('light');
    }
    const iconCss = trayIconCss(settings, scopeClass, {hover: true, stockForeground: _popupStockForeground(settings)});
    return {
        widget: popup,
        css: iconCss + (isCustom ? _popupCss(settings, scopeClass) : ''),
        guides: spacingGuides(settings, 'enable-custom-overflow-style', [popup],
            {spacingPrefix: 'overflow-container', borderPrefix: 'overflow-container'}),
    };
}

// A custom popup paints its own background, so its stock icons contrast with
// that as the shell does. A stock popup is painted light or dark by the preview
// itself and its icons follow that choice.
function _popupStockForeground(settings) {
    const editsLight = editsLightFor(settings, 'overflow-container-color-split');
    let isLight = null;
    if (settings.get_boolean('enable-custom-overflow-style')) {
        const rgba = new Gdk.RGBA();
        if (rgba.parse(resolveColor(settings, 'overflow-container-background-color')))
            isLight = backgroundIsLight(rgba);
    }
    const isOnLight = isLight ?? editsLight;
    return isOnLight ? THEME_FOREGROUND.onLight : THEME_FOREGROUND.onDark;
}

function _popupCss(settings, scopeClass) {
    const bg = resolveColor(settings, 'overflow-container-background-color');
    return `.${scopeClass}-popup { ${boxGeometryCss(settings, {spacingPrefix: 'overflow-container'})}` +
        `${backgroundStyle(bg)}${borderStyle(settings, 'overflow-container')} }`;
}
