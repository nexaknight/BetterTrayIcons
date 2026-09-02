import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Gsk from 'gi://Gsk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {connectScoped} from '../../shared/lifecycle.js';
import {alignFor, createBox, createLabel, ensurePrefsCss} from './text.js';

const CARD_WIDTH_PX = 110;
const CARD_HEIGHT_PX = 130;
const CARD_ICON_PX = 40;
const CARD_TITLE_MAX_CHARS = 12;
const CARD_SUBTITLE_MAX_CHARS = 14;

const CARD_CAPTION_GAP_PX = 4;
const CARD_CAPTION_TOP_PX = 10;
const CARD_CAPTION_BOTTOM_PX = 6;
const CARD_CAPTION_SIDE_PX = 8;

const CARD_GRID_GAP_PX = 12;
const CARD_DEFAULT_COLUMNS = 3;

const CARD_ROW_GAP_PX = 12;
const CARD_ROW_MARGIN_PX = 4;
const CARD_ROW_ALIGN_CENTER = 0.5;

// libadwaita clamps page content to 576px however wide the window gets.
// At 150 three columns still fit from 474px up, at 180 they need the full clamp.
const CARD_MIN_WIDTH_PX = 150;

export function createCardPicker({title, description = '', settings, key, options, bleed = false}) {
    ensurePrefsCss();
    const group = new Adw.PreferencesGroup({title, description});

    const grid = new Gtk.Box({
        layout_manager: new CardGridLayout(CARD_MIN_WIDTH_PX, CARD_DEFAULT_COLUMNS),
        hexpand: true,
    });
    group.add(grid);

    const cards = new Map(options.map(option => [option.value, createCard({
        preview: option.preview,
        bleed,
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
        grid.append(card);
    }

    const sync = () => cards.get(settings.get_string(key))?.set_active(true);
    sync();

    for (const [value, card] of cards) {
        card.connect('toggled', () => {
            if (card.active && settings.get_string(key) !== value)
                settings.set_string(key, value);
        });
    }
    connectScoped(grid, settings, `changed::${key}`, sync);

    return group;
}

export function createCard({
    avatar = null,
    iconName = null,
    iconSize = CARD_ICON_PX,
    preview = null,
    bleed = false,
    title = '',
    subtitle = '',
    onActivate = null,
    tooltip = null,
    toggle = false,
    extraClasses = [],
    width = CARD_WIDTH_PX,
    height = CARD_HEIGHT_PX,
    valign = 'center',
} = {}) {
    const ButtonClass = toggle ? Gtk.ToggleButton : Gtk.Button;
    const button = new ButtonClass({
        css_classes: ['card', 'flat', ...extraClasses],
        width_request: width,
        height_request: height,
        valign: alignFor(valign),
        // GTK expands a parent whose child expands, and the preview's vexpand
        // would otherwise grow the card to the full page height.
        vexpand: false,
    });

    if (tooltip)
        button.tooltip_text = tooltip;

    button.set_child(preview
        ? _buildStagedCard({preview, bleed, title, subtitle})
        : _buildCaptionedCard({avatar, iconName, iconSize, title, subtitle}));

    if (onActivate)
        button.connect('clicked', onActivate);

    return button;
}

// Stage and footer run edge to edge, a margin would show the card's own
// background as a frame around the scene.
function _buildStagedCard({preview, bleed, title, subtitle}) {
    ensurePrefsCss();

    const stage = createBox({vexpand: true, cssClasses: bleed ? ['bti-card-stage', 'bleed'] : ['bti-card-stage']});
    // GTK4 does not clip a child to its parent's rounded corners, so a scene
    // wider than the stage sticks out past the card's top edge.
    stage.overflow = Gtk.Overflow.HIDDEN;
    const align = bleed ? Gtk.Align.FILL : Gtk.Align.CENTER;
    preview.set_halign(align);
    preview.set_valign(align);
    stage.append(preview);

    const footer = createBox({halign: 'fill', cssClasses: ['bti-card-footer']});
    if (title)
        footer.append(_createCardCaption(title, ['caption-heading'], CARD_TITLE_MAX_CHARS, 'start'));
    if (subtitle)
        footer.append(_createCardCaption(subtitle, ['caption', 'dim-label'], CARD_SUBTITLE_MAX_CHARS, 'start'));

    const box = createBox({halign: 'fill'});
    box.append(stage);
    box.append(footer);
    return box;
}

function _buildCaptionedCard({avatar, iconName, iconSize, title, subtitle}) {
    const box = createBox({
        spacing: CARD_CAPTION_GAP_PX,
        halign: 'center',
        // FILL keeps the caption a fixed distance from the bottom edge. Under
        // CENTER a taller picture leaves captions across a row unaligned.
        valign: 'fill',
        margin_top: CARD_CAPTION_TOP_PX,
        margin_bottom: CARD_CAPTION_BOTTOM_PX,
        margin_start: CARD_CAPTION_SIDE_PX,
        margin_end: CARD_CAPTION_SIDE_PX,
    });

    let top = avatar;
    if (!top && iconName)
        top = new Gtk.Image({icon_name: iconName, pixel_size: iconSize});
    if (top) {
        top.set_halign(Gtk.Align.CENTER);
        top.set_valign(Gtk.Align.CENTER);
        top.set_vexpand(true);
        box.append(top);
    }

    if (title)
        box.append(_createCardCaption(title, ['caption-heading'], CARD_TITLE_MAX_CHARS, 'center'));
    if (subtitle)
        box.append(_createCardCaption(subtitle, ['caption', 'dim-label'], CARD_SUBTITLE_MAX_CHARS, 'center'));

    return box;
}

function _createCardCaption(text, cssClasses, maxChars, halign) {
    return createLabel(text, cssClasses, {
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: maxChars,
        halign: alignFor(halign),
    });
}

export function createCardRow({cards}) {
    const wrap = new Adw.WrapBox({
        child_spacing: CARD_ROW_GAP_PX,
        line_spacing: CARD_ROW_GAP_PX,
        align: CARD_ROW_ALIGN_CENTER,
        margin_top: CARD_ROW_MARGIN_PX,
        margin_bottom: CARD_ROW_MARGIN_PX,
        margin_start: CARD_ROW_MARGIN_PX,
        margin_end: CARD_ROW_MARGIN_PX,
    });
    cards.forEach(c => wrap.append(c));
    return wrap;
}

// Gtk.FlowBox reflows too, but it wraps every child in a GtkFlowBoxChild
// of its own.
const CardGridLayout = GObject.registerClass(
    {GTypeName: 'BetterTrayIconsCardGridLayout'},
    class CardGridLayout extends Gtk.LayoutManager {
        _init(minCardWidth, maxColumns) {
            super._init();
            this._minCardWidth = minCardWidth;
            this._maxColumns = maxColumns;
        }

        vfunc_get_request_mode(_widget) {
            return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
        }

        vfunc_measure(widget, orientation, forSize) {
            const cards = _cardsOf(widget);
            if (!cards.length)
                return [0, 0, -1, -1];

            if (orientation === Gtk.Orientation.HORIZONTAL) {
                const min = Math.max(...cards.map(card => card.measure(orientation, -1)[0]));
                const columns = this._columns(-1, cards.length);
                return [min, this._minCardWidth * columns + CARD_GRID_GAP_PX * (columns - 1), -1, -1];
            }

            const columns = this._columns(forSize, cards.length);
            const cardWidth = _cardWidthFor(forSize, columns);
            let min = 0;
            let nat = 0;
            for (const row of _rowsOf(cards, columns)) {
                const gap = min ? CARD_GRID_GAP_PX : 0;
                min += gap + Math.max(...row.map(card => card.measure(orientation, cardWidth)[0]));
                nat += gap + Math.max(...row.map(card => card.measure(orientation, cardWidth)[1]));
            }
            return [min, nat, -1, -1];
        }

        vfunc_allocate(widget, width, _height, _baseline) {
            const cards = _cardsOf(widget);
            const columns = this._columns(width, cards.length);
            const cardWidth = _cardWidthFor(width, columns);
            let y = 0;
            for (const row of _rowsOf(cards, columns)) {
                const height = Math.max(
                    ...row.map(card => card.measure(Gtk.Orientation.VERTICAL, cardWidth)[1]));
                _placeRow(row, cardWidth, height, y);
                y += height + CARD_GRID_GAP_PX;
            }
        }

        // forSize is -1 while GTK asks what the widget would like rather than
        // what it is getting, and the answer is then the full spread.
        _columns(width, count) {
            const cap = Math.min(this._maxColumns, count);
            if (width < 0)
                return cap;
            const fits = Math.floor((width + CARD_GRID_GAP_PX) /
                (this._minCardWidth + CARD_GRID_GAP_PX));
            return Math.max(1, Math.min(cap, fits));
        }
    });

function _placeRow(row, cardWidth, height, y) {
    row.forEach((card, column) => card.allocate(cardWidth, height, -1,
        Gsk.Transform.new().translate(new Graphene.Point({
            x: column * (cardWidth + CARD_GRID_GAP_PX),
            y,
        }))));
}

function _cardsOf(widget) {
    const out = [];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        out.push(child);
    return out;
}

function _rowsOf(cards, columns) {
    const rows = [];
    for (let i = 0; i < cards.length; i += columns)
        rows.push(cards.slice(i, i + columns));
    return rows;
}

function _cardWidthFor(width, columns) {
    return Math.max(1, Math.floor((width - CARD_GRID_GAP_PX * (columns - 1)) / columns));
}
