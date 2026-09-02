import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

import {boxGeometryCss} from '../../../shared/boxStyle.js';
import {THEME_FOREGROUND} from '../../../shared/colorContrast.js';
import {spacingGuides} from '../guide.js';
import {
    PREVIEW_SAMPLE_ICONS, backgroundStyle, borderStyle, createSampleIcon, cssDeclaration,
    customIconStyle, hoverStyle, resolveColor, stockForeground, stockIconStyle, trayIconCss,
} from './sceneInk.js';

export function buildTogglePreview(settings, scopeClass) {
    const box = new Gtk.Box();
    const toggle = new Gtk.Image({
        icon_name: _toggleIconName(settings, 'toggle-icon-name'),
        pixel_size: settings.get_int('toggle-icon-size'),
        css_classes: [`${scopeClass}-toggle`],
        cursor: Gdk.Cursor.new_from_name('pointer', null),
    });
    _bindToggleClicks(settings, toggle);
    const size = settings.get_int('icon-size');
    const icons = PREVIEW_SAMPLE_ICONS.slice(0, 2).map(name => createSampleIcon(name, size, scopeClass));

    const parts = settings.get_string('toggle-position') === 'left'
        ? [toggle, ...icons] : [...icons, toggle];
    parts.forEach(part => box.append(part));

    const prefixes = _toggleInheritsIconStyle(settings)
        ? {spacingPrefix: 'icon', borderPrefix: 'icon'}
        : {spacingPrefix: 'toggle', borderPrefix: 'toggle-icon'};
    return {
        widget: box,
        css: trayIconCss(settings, scopeClass) + _toggleCss(settings, scopeClass) + _toggleOpenCss(settings, scopeClass),
        guides: spacingGuides(settings, 'enable-custom-toggle-style', [toggle], prefixes),
    };
}

// The shell turns or swaps the icon while the popup is open, the sample
// does the same per click.
function _bindToggleClicks(settings, toggle) {
    const click = new Gtk.GestureClick();
    let isOpen = false;
    click.connect('released', () => {
        isOpen = !isOpen;
        if (!settings.get_boolean('toggle-icon-rotate')) {
            toggle.icon_name = _toggleIconName(settings, isOpen ? 'toggle-icon-active-name' : 'toggle-icon-name');
            return;
        }
        if (isOpen)
            toggle.add_css_class('open');
        else
            toggle.remove_css_class('open');
    });
    toggle.add_controller(click);
}

function _toggleIconName(settings, key) {
    return settings.get_string(key) || settings.get_default_value(key).unpack();
}

function _toggleOpenCss(settings, scopeClass) {
    if (!settings.get_boolean('toggle-icon-rotate'))
        return '';
    const selector = `.${scopeClass}-toggle`;
    const degrees = Number.parseInt(settings.get_string('toggle-icon-rotate-angle'), 10);
    const angle = settings.get_boolean('toggle-icon-rotate-reverse') ? -degrees : degrees;
    const transition = settings.get_boolean('toggle-icon-rotate-animate')
        ? ` ${selector} { transition: -gtk-icon-transform ${settings.get_int('toggle-icon-rotate-duration')}ms ease-out` +
            ` ${settings.get_int('toggle-icon-rotate-delay')}ms; }`
        : '';
    return `${transition} ${selector}.open { -gtk-icon-transform: rotate(${angle}deg); }`;
}

function _toggleCss(settings, scopeClass) {
    const selector = `.${scopeClass}-toggle`;

    if (_toggleInheritsIconStyle(settings)) {
        return `${selector} { ${customIconStyle(settings)} }` +
            ` ${selector}:hover { ${hoverStyle(settings, 'icon')} }`;
    }

    if (settings.get_boolean('enable-custom-toggle-style')) {
        const color = resolveColor(settings, 'toggle-icon-color');
        const bg = resolveColor(settings, 'toggle-icon-background-color');
        const geometry = boxGeometryCss(settings, {spacingPrefix: 'toggle', radiusPrefix: 'toggle-icon'});
        return `${selector} { ${geometry}` +
            `${cssDeclaration('color', color || THEME_FOREGROUND.onDark)}${backgroundStyle(bg)}${borderStyle(settings, 'toggle-icon')} }` +
            ` ${selector}:hover { ${hoverStyle(settings, 'toggle-icon')} }`;
    }

    return `${selector} { ${stockIconStyle(stockForeground(settings, 'toggle-icon-color-split'))} }`;
}

function _toggleInheritsIconStyle(settings) {
    return settings.get_boolean('enable-custom-toggle-style') &&
        settings.get_boolean('toggle-inherit-icon-style') &&
        settings.get_boolean('enable-custom-icon-style');
}
