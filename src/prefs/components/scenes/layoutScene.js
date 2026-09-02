import Gtk from 'gi://Gtk';

import {ensurePrefsCss} from '../text.js';
import {PREVIEW_SAMPLE_ICONS} from './sceneInk.js';

const THUMBNAIL_ICON_PX = 14;
const THUMBNAIL_SPACING_PX = 6;
const THUMBNAIL_COLUMNS = 2;

export function buildLayoutThumbnail(mode) {
    ensurePrefsCss();
    const names = PREVIEW_SAMPLE_ICONS.slice(0, 4);
    let inner;
    if (mode === 'row') {
        inner = new Gtk.Box({spacing: THUMBNAIL_SPACING_PX});
        names.forEach(name => inner.append(new Gtk.Image({icon_name: name, pixel_size: THUMBNAIL_ICON_PX})));
    } else {
        inner = new Gtk.Grid({row_spacing: THUMBNAIL_SPACING_PX, column_spacing: THUMBNAIL_SPACING_PX});
        names.forEach((name, i) =>
            inner.attach(new Gtk.Image({icon_name: name, pixel_size: THUMBNAIL_ICON_PX}),
                i % THUMBNAIL_COLUMNS, Math.floor(i / THUMBNAIL_COLUMNS), 1, 1));
    }
    const popup = new Gtk.Box({css_classes: ['bti-thumbnail-popup'], halign: Gtk.Align.CENTER});
    popup.append(inner);
    return popup;
}
