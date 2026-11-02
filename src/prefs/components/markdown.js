import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Gsk from 'gi://Gsk';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {ensurePrefsCss} from './text.js';

const MARKDOWN_MARGIN_PX = 12;
const CHIP_INSET_H_PX = 3;
const CHIP_INSET_V_PX = 1;
const CHIP_RADIUS_PX = 4;
const CHIP_ALPHA = 0.12;
const BLOCK_GAP_PX = 12;
const LIST_ITEM_GAP_PX = 4;
const LIST_INDENT_PX = 20;
const LIST_MARKER_GAP_PX = 6;
const CODE_PADDING_V_PX = 8;
const CODE_PADDING_H_PX = 12;
const TABLE_COLUMN_GAP_PX = 16;
const TABLE_ROW_GAP_PX = 4;

const HEADING_SIZES = Object.freeze(['x-large', 'large']);
const BULLETS = Object.freeze(['•', '◦', '▪']);
const TASK_OPEN = '☐';
const TASK_DONE = '☑';
const ENTITIES = Object.freeze({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–', hellip: '…',
});

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const LIST_ITEM = /^(\s*)([*+-]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const HTML_COMMENT = /^\s*<!--[\s\S]*-->\s*$/;
const HARD_BREAK = /(?: {2,}|\\)$/;

// Private-use characters hold the already converted inline parts while the
// rest of the line is escaped, so nothing from the document becomes markup.
const SLOT_OPEN = '\u{E000}';
const SLOT_CLOSE = '\u{E001}';

export function createMarkdownView(markdown, header = '') {
    ensurePrefsCss();
    const view = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: BLOCK_GAP_PX,
        margin_top: MARKDOWN_MARGIN_PX,
        margin_bottom: MARKDOWN_MARGIN_PX,
        margin_start: MARKDOWN_MARGIN_PX,
        margin_end: MARKDOWN_MARGIN_PX,
    });
    if (header)
        view.append(_createText(header));
    const lines = String(markdown ?? '').replace(/\r/g, '').split('\n');
    _parseBlocks(lines).forEach(block => view.append(_renderBlock(block)));
    return view;
}

function _parseBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim() || HTML_COMMENT.test(line)) {
            i++;
            continue;
        }
        const isAfterList = blocks.at(-1)?.type === 'list';
        let end;
        if (FENCE.test(line))
            end = _readFence(lines, i, blocks);
        else if (INDENTED_CODE.test(line) && !isAfterList)
            end = _readIndentedCode(lines, i, blocks);
        else if (HEADING.test(line))
            end = _readHeading(lines, i, blocks);
        else if (RULE.test(line))
            end = _push(blocks, {type: 'rule'}, i + 1);
        else if (_isTableStart(lines, i))
            end = _readTable(lines, i, blocks);
        else if (QUOTE.test(line))
            end = _readQuote(lines, i, blocks);
        else if (LIST_ITEM.test(line))
            end = _readList(lines, i, blocks);
        else
            end = _readParagraph(lines, i, blocks);
        i = end;
    }
    return blocks;
}

function _push(blocks, block, next) {
    blocks.push(block);
    return next;
}

function _readFence(lines, start, blocks) {
    const fence = lines[start].match(FENCE)[1];
    const body = [];
    let i = start + 1;
    while (i < lines.length && !lines[i].trimStart().startsWith(fence))
        body.push(lines[i++]);
    return _push(blocks, {type: 'code', text: body.join('\n')}, i + 1);
}

function _readIndentedCode(lines, start, blocks) {
    const body = [];
    let i = start;
    while (i < lines.length && (INDENTED_CODE.test(lines[i]) || !lines[i].trim()))
        body.push(lines[i++].replace(INDENTED_CODE, ''));
    return _push(blocks, {type: 'code', text: body.join('\n').trimEnd()}, i);
}

function _readHeading(lines, start, blocks) {
    const [, marks, text = ''] = lines[start].match(HEADING);
    return _push(blocks, {type: 'heading', level: marks.length, text}, start + 1);
}

function _isTableStart(lines, i) {
    return lines[i].includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]) &&
        lines[i + 1].includes('-');
}

function _readTable(lines, start, blocks) {
    const aligns = _tableCells(lines[start + 1]).map(cell => {
        if (cell.startsWith(':') && cell.endsWith(':'))
            return 0.5;
        return cell.endsWith(':') ? 1 : 0;
    });
    const rows = [_tableCells(lines[start])];
    let i = start + 2;
    while (i < lines.length && lines[i].includes('|') && lines[i].trim())
        rows.push(_tableCells(lines[i++]));
    return _push(blocks, {type: 'table', aligns, rows}, i);
}

function _tableCells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim());
}

// One quote level is stripped and the rest parsed again, so a quote inside
// a quote nests one indent deeper.
function _readQuote(lines, start, blocks) {
    const inner = [];
    let i = start;
    while (i < lines.length && QUOTE.test(lines[i]))
        inner.push(lines[i++].replace(QUOTE, ''));
    return _push(blocks, {type: 'quote', blocks: _parseBlocks(inner)}, i);
}

function _readList(lines, start, blocks) {
    const items = [];
    const indents = [];
    let i = start;
    for (; i < lines.length; i++) {
        const line = lines[i];
        const item = line.match(LIST_ITEM);
        if (item) {
            const indent = item[1].length;
            // Switching between bullets and numbers at the top starts a new list
            const isTopLevel = !indents.length || indent <= indents[0];
            if (isTopLevel && items.length && _isOrdered(item[2]) !== _isOrdered(items[0].marker))
                break;
            while (indents.length && indents.at(-1) > indent)
                indents.pop();
            if (!indents.length || indents.at(-1) < indent)
                indents.push(indent);
            items.push({level: indents.length - 1, marker: item[2], text: item[3]});
            continue;
        }
        const isContinuation = line.trim() && /^\s/.test(line) && items.length;
        if (isContinuation) {
            items.at(-1).text = `${_joinLine(items.at(-1).text)}${line.trim()}`;
            continue;
        }
        const nextIsItem = !line.trim() && LIST_ITEM.test(lines[i + 1] ?? '');
        if (!nextIsItem)
            break;
    }
    return _push(blocks, {type: 'list', items}, i);
}

function _isOrdered(marker) {
    return /\d/.test(marker);
}

function _readParagraph(lines, start, blocks) {
    let text = lines[start].trimStart();
    let i = start + 1;
    for (; i < lines.length; i++) {
        const line = lines[i];
        const startsBlock = !line.trim() || FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) ||
            LIST_ITEM.test(line) || RULE.test(line);
        if (startsBlock)
            break;
        text = `${_joinLine(text)}${line.trimStart()}`;
    }
    return _push(blocks, {type: 'paragraph', text: text.replace(HARD_BREAK, '').trimEnd()}, i);
}

// Two trailing spaces or a backslash end the line hard, anything else is a
// soft break that joins with a space.
function _joinLine(text) {
    return HARD_BREAK.test(text) ? `${text.replace(HARD_BREAK, '')}\n` : `${text.trimEnd()} `;
}

function _renderBlock(block) {
    switch (block.type) {
    case 'heading':
        return _createText(_headingMarkup(block.level, _inlineMarkup(block.text)));
    case 'code':
        return _createScroller(new Gtk.Label({
            label: block.text,
            xalign: 0,
            focusable: false,
            css_classes: ['monospace'],
            margin_top: CODE_PADDING_V_PX,
            margin_bottom: CODE_PADDING_V_PX,
            margin_start: CODE_PADDING_H_PX,
            margin_end: CODE_PADDING_H_PX,
        }), ['bti-markdown-code']);
    case 'quote':
        return _renderQuote(block.blocks);
    case 'list':
        return _renderList(block.items);
    case 'rule':
        return new Gtk.Separator();
    case 'table':
        return _renderTable(block);
    default:
        return _createText(_inlineMarkup(block.text));
    }
}

function _headingMarkup(level, markup) {
    const size = HEADING_SIZES[level - 1];
    return size ? `<span weight="bold" size="${size}">${markup}</span>` : `<b>${markup}</b>`;
}

function _renderQuote(blocks) {
    const quote = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: BLOCK_GAP_PX,
        css_classes: ['bti-markdown-quote'],
    });
    blocks.forEach(block => quote.append(_renderBlock(block)));
    return quote;
}

function _renderList(items) {
    const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: LIST_ITEM_GAP_PX});
    for (const {level, marker, text} of items) {
        const task = text.match(TASK);
        let symbol = _isOrdered(marker) ? GLib.markup_escape_text(marker, -1) : BULLETS[level % BULLETS.length];
        if (task)
            symbol = task[1] === ' ' ? TASK_OPEN : TASK_DONE;
        const row = new Gtk.Box({spacing: LIST_MARKER_GAP_PX, margin_start: level * LIST_INDENT_PX});
        row.append(_createText(symbol, {hexpand: false, valign: Gtk.Align.START}));
        row.append(_createText(_inlineMarkup(task ? text.replace(TASK, '') : text)));
        list.append(row);
    }
    return list;
}

// A grid rather than a monospace block, so the cells keep the proportional
// font and their inline formatting while the columns still line up.
function _renderTable({aligns, rows}) {
    const grid = new Gtk.Grid({column_spacing: TABLE_COLUMN_GAP_PX, row_spacing: TABLE_ROW_GAP_PX});
    rows.forEach((cells, row) => cells.forEach((cell, column) => {
        const markup = _inlineMarkup(cell);
        grid.attach(_createText(row === 0 ? `<b>${markup}</b>` : markup, {
            wrap: false,
            hexpand: false,
            xalign: aligns[column] ?? 0,
        }), column, row, 1, 1);
    }));
    return _createScroller(grid);
}

function _createScroller(child, cssClasses = []) {
    return new Gtk.ScrolledWindow({
        child,
        hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        vscrollbar_policy: Gtk.PolicyType.NEVER,
        propagate_natural_height: true,
        css_classes: cssClasses,
    });
}

// Not focusable, for the reason given at showTextDialog in dialog.js.
function _createText(markup, props = {}) {
    return new MarkdownLabel({
        label: _validMarkup(markup),
        use_markup: true,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        xalign: 0,
        hexpand: true,
        focusable: false,
        ...props,
    });
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
            for (const [start, end] of _monospaceRanges(layout)) {
                for (const rect of _chipRects(layout, start, end)) {
                    const bounds = new Graphene.Rect().init(
                        offsetX + rect.x - CHIP_INSET_H_PX, offsetY + rect.y - CHIP_INSET_V_PX,
                        rect.width + 2 * CHIP_INSET_H_PX, rect.height + 2 * CHIP_INSET_V_PX);
                    snapshot.push_rounded_clip(new Gsk.RoundedRect().init_from_rect(bounds, CHIP_RADIUS_PX));
                    snapshot.append_color(color, bounds);
                    snapshot.pop();
                }
            }
            super.vfunc_snapshot(snapshot);
        }
    });

function _monospaceRanges(layout) {
    return (layout.get_attributes()?.get_attributes() ?? [])
        // Only the family attribute carries the string 'monospace'
        .filter(attr => attr.as_string()?.value === 'monospace')
        .map(attr => [attr.start_index, attr.end_index]);
}

// Byte range to one rectangle per layout line it touches, in pixels relative
// to the layout origin.
function _chipRects(layout, start, end) {
    const rects = [];
    const iter = layout.get_iter();
    do {
        const line = iter.get_line_readonly();
        const lineEnd = line.start_index + line.length;
        const from = Math.max(start, line.start_index);
        const to = Math.min(end, lineEnd);
        if (from >= to)
            continue;
        const [, logical] = iter.get_line_extents();
        const glyph = layout.index_to_pos(from);
        const left = logical.x + line.index_to_x(from, false);
        const right = logical.x + line.index_to_x(to, false);
        rects.push({
            x: left / Pango.SCALE,
            y: glyph.y / Pango.SCALE,
            width: (right - left) / Pango.SCALE,
            height: glyph.height / Pango.SCALE,
        });
    } while (iter.next_line());
    return rects;
}

// Emphasis markers that cross each other produce tags Pango refuses, the
// label would then show nothing, so such a line falls back to its plain text.
// Links are a GtkLabel addition Pango itself does not parse.
function _validMarkup(markup) {
    try {
        Pango.parse_markup(markup.replace(/<a href="[^"]*">/g, '<span>').replace(/<\/a>/g, '</span>'), -1, '\0');
        return markup;
    } catch {
        return markup.replace(/<[^>]*>/g, '');
    }
}

// Headings need the inline pass too, release-please puts the compare link
// right inside the version heading.
function _inlineMarkup(text) {
    const slots = [];
    const keep = markup => `${SLOT_OPEN}${slots.push(markup) - 1}${SLOT_CLOSE}`;
    const escape = raw => GLib.markup_escape_text(_decodeEntities(raw), -1);

    const protectedText = text.replace(/[\u{E000}\u{E001}]/gu, '')
        .replace(/\\([!-/:-@[-`{-~])/g, (_match, char) => keep(GLib.markup_escape_text(char, -1)))
        .replace(/(`+)(.+?)\1(?!`)/g, (_match, _ticks, code) =>
            keep(`<span font_family="monospace" size="90%">${GLib.markup_escape_text(code.trim(), -1)}</span>`))
        .replace(/<((?:https?|mailto):[^\s<>]+)>/g, (_match, url) => keep(`<a href="${_href(url)}">${_href(url)}</a>`))
        .replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, (_match, alt) => keep(`<i>${escape(alt)}</i>`))
        .replace(/\[([^\]]+)\]\(((?:https?|mailto):[^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, label, url) =>
            `${keep(`<a href="${_href(url)}">`)}${label}${keep('</a>')}`);

    const markup = escape(protectedText)
        .replace(/\*\*\*(?=\S)(.*?\S)\*\*\*/g, '<b><i>$1</i></b>')
        .replace(/\*\*(?=\S)(.*?\S)\*\*/g, '<b>$1</b>')
        .replace(/(^|\W)__(?=\S)(.*?\S)__(?!\w)/g, '$1<b>$2</b>')
        .replace(/\*(?=\S)(.*?\S)\*/g, '<i>$1</i>')
        .replace(/(^|\W)_(?=\S)(.*?\S)_(?!\w)/g, '$1<i>$2</i>')
        .replace(/~~(?=\S)(.*?\S)~~/g, '<s>$1</s>');
    // A code span can hold an escaped character, so its slot holds a slot
    let restored = markup;
    while (restored.includes(SLOT_OPEN))
        restored = restored.replace(/\u{E000}(\d+)\u{E001}/gu, (_match, index) => slots[index]);
    return restored;
}

function _href(url) {
    return GLib.markup_escape_text(url, -1);
}

function _decodeEntities(text) {
    return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name) => {
        if (name.startsWith('#')) {
            const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return ENTITIES[name.toLowerCase()] ?? match;
    });
}
