import Gtk from 'gi://Gtk';

import {spacingGuides} from '../guide.js';
import {PREVIEW_SAMPLE_ICONS, createSampleIcon, trayIconCss} from './sceneInk.js';

export function buildTrayPreview(settings, scopeClass) {
    const box = new Gtk.Box();
    const size = settings.get_int('icon-size');
    const icons = PREVIEW_SAMPLE_ICONS.slice(0, 4).map(name => createSampleIcon(name, size, scopeClass));
    icons.forEach(icon => box.append(icon));
    return {
        widget: box,
        css: trayIconCss(settings, scopeClass, {hover: true}),
        guides: spacingGuides(settings, 'enable-custom-icon-style', icons, {spacingPrefix: 'icon', borderPrefix: 'icon'}),
    };
}
