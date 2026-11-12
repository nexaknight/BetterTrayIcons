import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {readFileText} from '../../shared/asyncIo.js';
import {packNameForPath} from '../iconPacks.js';
import {EMOJI_ICON_PREFIX, emojiText, isEmojiIcon} from '../../shared/iconLoading.js';

const EMOJI_CATALOG_FILE = Gio.File.new_for_uri(import.meta.url)
    .get_parent().get_parent().get_parent().get_parent()
    .get_child('assets').get_child('emoji').get_child('emoji.json');

// Same padding ring as the shell's emoji label, see EMOJI_GLYPH_ICON_RATIO
// in src/shell/icons/iconContent.js.
const EMOJI_GLYPH_RATIO = 0.83;

// A colour glyph ignores the paint, it only has to be a valid one.
const GLYPH_PAINT = new Gdk.RGBA({red: 0, green: 0, blue: 0, alpha: 1});

const FILE_EXTENSION_RE = /\.[^.]+$/;

let _pangoContext = null;

export const EmojiPaintable = GObject.registerClass({
    GTypeName: 'BetterTrayIconsEmojiPaintable',
    Implements: [Gdk.Paintable],
}, class EmojiPaintable extends GObject.Object {
    _init(text) {
        super._init();
        this._text = text;
    }

    vfunc_snapshot(snapshot, width, height) {
        _pangoContext ??= PangoCairo.FontMap.get_default().create_context();
        const layout = Pango.Layout.new(_pangoContext);
        const font = new Pango.FontDescription();
        font.set_absolute_size(Math.min(width, height) * EMOJI_GLYPH_RATIO * Pango.SCALE);
        layout.set_font_description(font);
        layout.set_text(this._text, -1);

        // Centered on the ink, the line box of an emoji font sits well
        // below its glyph.
        const [ink] = layout.get_pixel_extents();
        snapshot.save();
        snapshot.translate(new Graphene.Point({
            x: (width - ink.width) / 2 - ink.x,
            y: (height - ink.height) / 2 - ink.y,
        }));
        snapshot.append_layout(layout, GLYPH_PAINT);
        snapshot.restore();
    }
});

let _catalog = null;

export function loadEmojiCatalog() {
    _catalog ??= readFileText(EMOJI_CATALOG_FILE).then(text =>
        JSON.parse(text).emoji.map(([hex, name, group, keywords]) => ({
            value: `${EMOJI_ICON_PREFIX}${hex}`,
            text: emojiText(`${EMOJI_ICON_PREFIX}${hex}`),
            name,
            group,
            search: ` ${name} ${keywords}`.toLowerCase(),
        })));
    _catalog.catch(() => (_catalog = null));
    return _catalog;
}

// The config keeps the codepoints, a row shows the emoji's name. The glyph
// stands in until the catalog answers, and a newer value wins over a late one.
export function setIconSubtitle(row, value, fallback = '') {
    row._btiSubtitleValue = value;
    if (value?.startsWith('/')) {
        _setPackIconSubtitle(row, value);
        return;
    }
    if (!isEmojiIcon(value)) {
        row.set_subtitle(value || fallback);
        return;
    }
    row.set_subtitle(emojiText(value) ?? value);
    loadEmojiCatalog().then(catalog => {
        const name = catalog.find(emoji => emoji.value === value)?.name;
        if (name && row._btiSubtitleValue === value)
            row.set_subtitle(name[0].toUpperCase() + name.slice(1));
    }).catch(() => {});
}

// A pack icon picked as a path reads "firefox (MacTahoe)". A file outside
// every icon pack keeps its path.
function _setPackIconSubtitle(row, path) {
    row.set_subtitle(path);
    packNameForPath(path).then(packName => {
        if (!packName || row._btiSubtitleValue !== path)
            return;
        const iconName = GLib.path_get_basename(path).replace(FILE_EXTENSION_RE, '');
        row.set_subtitle(`${iconName} (${packName})`);
    }).catch(() => {});
}
