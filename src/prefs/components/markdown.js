import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Gsk from 'gi://Gsk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {clearIds, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {createIconButton} from './button.js';
import {ensurePrefsCss} from './text.js';
import {BULLETS, HEADING_CLASSES, TASK, TASK_DONE, TASK_OPEN, inlineMarkup, isOrdered, parseMarkdown} from '../../shared/markdownParse.js';

const MARKDOWN_MARGIN_PX = 12;
const CHIP_INSET_H_PX = 3;
const CHIP_INSET_V_PX = 1;
const CHIP_RADIUS_PX = 4;
const CHIP_ALPHA = 0.12;
const BLOCK_GAP_PX = 12;
// Space a heading adds above the block gap, by level, so a section starts
// visibly apart from the one before and sits close to its own text
const HEADING_SPACE_PX = Object.freeze([12, 12, 6, 6, 0, 0]);
const LIST_ITEM_GAP_PX = 4;
const LIST_INDENT_PX = 20;
const LIST_MARKER_GAP_PX = 6;
const CODE_PADDING_V_PX = 8;
const CODE_PADDING_H_PX = 12;
const CODE_LANG_GAP_PX = 4;
const TABLE_COLUMN_GAP_PX = 16;
const TABLE_ROW_GAP_PX = 4;
const COPY_BUTTON_MARGIN_PX = 6;
// Keeps the first line of a code block clear of the copy button
const CODE_BUTTON_RESERVE_PX = 40;
const COPIED_RESET_MS = 1500;
const COPY_ICON_NAME = 'bti-copy-symbolic';
const COPIED_ICON_NAME = 'bti-select-symbolic';
const VIEW_CSS_CLASS = 'bti-markdown-view';

const LINK_OPEN_TAG_RE = /<a href="[^"]*">/g;
const LINK_CLOSE_TAG_RE = /<\/a>/g;
const MARKUP_TAG_RE = /<[^>]*>/g;

const PANGO_MARKUP = Object.freeze({
    escape: text => GLib.markup_escape_text(text, -1),
    codeSpan: code => `<span font_family="monospace" size="90%">${code}</span>`,
    linkOpen: href => `<a href="${href}">`,
    image: (_src, alt) => `<i>${alt}</i>`,
});

export function createMarkdownView(markdown, header = '') {
    return createBlocksView(parseMarkdown(markdown), header);
}

export function createBlocksView(blocks, header = '') {
    ensurePrefsCss();
    const view = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: BLOCK_GAP_PX,
        margin_top: MARKDOWN_MARGIN_PX,
        margin_bottom: MARKDOWN_MARGIN_PX,
        margin_start: MARKDOWN_MARGIN_PX,
        margin_end: MARKDOWN_MARGIN_PX,
        css_classes: [VIEW_CSS_CLASS],
    });
    if (header)
        view.append(_createText(header));
    _appendBlocks(view, blocks);
    return view;
}

function _appendBlocks(box, blocks) {
    blocks.forEach(block => box.append(_renderBlock(block)));
    box.get_first_child()?.set_margin_top(0);
}

function _renderBlock(block) {
    switch (block.type) {
    case 'heading':
        return _createText(inlineMarkup(block.text, PANGO_MARKUP), {
            css_classes: [HEADING_CLASSES[block.level - 1]],
            margin_top: HEADING_SPACE_PX[block.level - 1],
            ...block.id && {name: block.id},
        });
    case 'code':
        return _renderCode(block);
    case 'quote':
        return _renderQuote(block.blocks);
    case 'list':
        return _renderList(block.items);
    case 'rule':
        return new Gtk.Separator();
    case 'table':
        return _renderTable(block);
    default:
        return _createText(inlineMarkup(block.text, PANGO_MARKUP));
    }
}

function _renderCode({text, lang}) {
    const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    if (lang) {
        body.append(new Gtk.Label({
            label: lang,
            xalign: 0,
            css_classes: ['caption', 'dimmed'],
            margin_top: CODE_PADDING_V_PX,
            margin_start: CODE_PADDING_H_PX,
        }));
    }
    body.append(new Gtk.Label({
        label: text,
        xalign: 0,
        selectable: true,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        focusable: false,
        css_classes: ['monospace'],
        margin_top: lang ? CODE_LANG_GAP_PX : CODE_PADDING_V_PX,
        margin_bottom: CODE_PADDING_V_PX,
        margin_start: CODE_PADDING_H_PX,
        margin_end: CODE_BUTTON_RESERVE_PX,
    }));
    const overlay = new Gtk.Overlay({child: body, css_classes: ['bti-markdown-code']});
    overlay.add_overlay(_createCopyButton(text));
    return overlay;
}

function _createCopyButton(text) {
    const timers = {};
    const button = createIconButton(COPY_ICON_NAME, {
        halign: 'end',
        valign: 'start',
        margin_top: COPY_BUTTON_MARGIN_PX,
        margin_end: COPY_BUTTON_MARGIN_PX,
        onClick: () => {
            Gdk.Display.get_default().get_clipboard().set(text);
            _setCopyState(button, COPIED_ICON_NAME, _('Copied'));
            debounceTo(timers, 'reset', COPIED_RESET_MS, () => _setCopyState(button, COPY_ICON_NAME, _('Copy')));
        },
    });
    _setCopyState(button, COPY_ICON_NAME, _('Copy'));
    button.connect('unrealize', () => {
        clearIds(timers, removeTimer, 'reset');
        _setCopyState(button, COPY_ICON_NAME, _('Copy'));
    });
    return button;
}

function _setCopyState(button, iconName, label) {
    button.icon_name = iconName;
    button.tooltip_text = label;
    button.update_property([Gtk.AccessibleProperty.LABEL], [label]);
}

function _renderQuote(blocks) {
    const quote = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: BLOCK_GAP_PX,
        css_classes: ['bti-markdown-quote'],
    });
    _appendBlocks(quote, blocks);
    return quote;
}

function _renderList(items) {
    const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: LIST_ITEM_GAP_PX});
    for (const {level, marker, text, id} of items) {
        const task = text.match(TASK);
        let symbol = isOrdered(marker) ? GLib.markup_escape_text(marker, -1) : BULLETS[level % BULLETS.length];
        if (task)
            symbol = task[1] === ' ' ? TASK_OPEN : TASK_DONE;
        const row = new Gtk.Box({spacing: LIST_MARKER_GAP_PX, margin_start: level * LIST_INDENT_PX, ...id && {name: id}});
        row.append(_createText(symbol, {hexpand: false, valign: Gtk.Align.START}));
        row.append(_createText(inlineMarkup(task ? text.replace(TASK, '') : text, PANGO_MARKUP)));
        list.append(row);
    }
    return list;
}

// A grid rather than a monospace block, so the cells keep the proportional
// font and their inline formatting while the columns still line up.
function _renderTable({aligns, rows}) {
    const grid = new Gtk.Grid({column_spacing: TABLE_COLUMN_GAP_PX, row_spacing: TABLE_ROW_GAP_PX});
    rows.forEach((cells, row) => cells.forEach((cell, column) => {
        const markup = inlineMarkup(cell, PANGO_MARKUP);
        grid.attach(_createText(row === 0 ? `<b>${markup}</b>` : markup, {
            wrap: false,
            hexpand: false,
            xalign: aligns[column] ?? 0,
        }), column, row, 1, 1);
    }));
    return _createScroller(grid);
}

function _createScroller(child) {
    return new Gtk.ScrolledWindow({
        child,
        hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        vscrollbar_policy: Gtk.PolicyType.NEVER,
        propagate_natural_height: true,
    });
}

// Not focusable, for the reason given at showTextDialog in dialog.js.
function _createText(markup, props = {}) {
    const label = new MarkdownLabel({
        label: _validMarkup(markup),
        use_markup: true,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        xalign: 0,
        hexpand: true,
        focusable: false,
        ...props,
    });
    label.connect('activate-link', _scrollToAnchor);
    return label;
}

// A #id link is a contents entry or a footnote, its target is the heading
// or list row of the same view carrying that id as widget name
function _scrollToAnchor(label, uri) {
    if (!uri.startsWith('#'))
        return false;
    let view = label;
    while (!view.has_css_class(VIEW_CSS_CLASS))
        view = view.get_parent();
    const target = _findNamed(view, uri.slice(1));
    const scroller = view.get_ancestor(Gtk.ScrolledWindow.$gtype);
    if (target) {
        const [, point] = target.compute_point(scroller, new Graphene.Point({x: 0, y: 0}));
        scroller.vadjustment.value += point.y;
    }
    return true;
}

function _findNamed(widget, name) {
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        if (child.name === name)
            return child;
        const found = _findNamed(child, name);
        if (found)
            return found;
    }
    return null;
}

// Pango can't round a span background, so the label draws a rounded chip
// behind every monospace run itself, one per line the run wraps over. Code
// spans are the only monospace runs a paragraph carries.
const MarkdownLabel = GObject.registerClass(
    {GTypeName: 'BetterTrayIconsMarkdownLabel'},
    class MarkdownLabel extends Gtk.Label {
        vfunc_snapshot(snapshot) {
            const layout = this.get_layout();
            const [offsetX, offsetY] = this.get_layout_offsets();
            const {red, green, blue} = this.get_color();
            const color = new Gdk.RGBA({red, green, blue, alpha: CHIP_ALPHA});
            const rects = _monospaceRanges(layout).flatMap(([start, end]) => _chipRects(layout, start, end));
            for (const rect of rects) {
                const bounds = new Graphene.Rect().init(
                    offsetX + rect.x - CHIP_INSET_H_PX, offsetY + rect.y - CHIP_INSET_V_PX,
                    rect.width + 2 * CHIP_INSET_H_PX, rect.height + 2 * CHIP_INSET_V_PX);
                snapshot.push_rounded_clip(new Gsk.RoundedRect().init_from_rect(bounds, CHIP_RADIUS_PX));
                snapshot.append_color(color, bounds);
                snapshot.pop();
            }
            super.vfunc_snapshot(snapshot);
        }
    });

function _monospaceRanges(layout) {
    return (layout.get_attributes()?.get_attributes() ?? [])
        // Only the family attribute carries the string 'monospace'
        .filter(attribute => attribute.as_string()?.value === 'monospace')
        .map(attribute => [attribute.start_index, attribute.end_index]);
}

// Byte range to one rectangle per layout line it touches, in pixels relative
// to the layout origin.
function _chipRects(layout, start, end) {
    const rects = [];
    const iterator = layout.get_iter();
    do {
        const line = iterator.get_line_readonly();
        const lineEnd = line.start_index + line.length;
        const from = Math.max(start, line.start_index);
        const to = Math.min(end, lineEnd);
        if (from >= to)
            continue;
        const [, logical] = iterator.get_line_extents();
        const glyph = layout.index_to_pos(from);
        const left = logical.x + line.index_to_x(from, false);
        const right = logical.x + line.index_to_x(to, false);
        rects.push({
            x: left / Pango.SCALE,
            y: glyph.y / Pango.SCALE,
            width: (right - left) / Pango.SCALE,
            height: glyph.height / Pango.SCALE,
        });
    } while (iterator.next_line());
    return rects;
}

// Emphasis markers that cross each other produce tags Pango refuses, the
// label would then show nothing, so such a line falls back to its plain text.
// Links are a GtkLabel addition Pango itself does not parse.
function _validMarkup(markup) {
    try {
        Pango.parse_markup(markup.replace(LINK_OPEN_TAG_RE, '<span>').replace(LINK_CLOSE_TAG_RE, '</span>'), -1, '\0');
        return markup;
    } catch {
        return markup.replace(MARKUP_TAG_RE, '');
    }
}
