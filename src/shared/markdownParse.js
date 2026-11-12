// Reads Markdown into blocks and inline markup for both viewers, the GTK one
// in src/prefs/components/markdown.js and the HTML one on the page.

// libadwaita's title classes, the page mirrors their sizes
export const HEADING_CLASSES = Object.freeze(['title-1', 'title-2', 'title-3', 'title-4', 'heading', 'heading']);
export const BULLETS = Object.freeze(['•', '◦', '▪']);
export const TASK_OPEN = '☐';
export const TASK_DONE = '☑';
const ENTITIES = Object.freeze({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–', hellip: '…',
    larr: '←', rarr: '→', times: '×', middot: '·', bull: '•', deg: '°',
    laquo: '«', raquo: '»', euro: '€',
});

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const HTML_HEADING = /^<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>$/i;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const CONTENTS = /^ {0,3}(?:\[TOC\]|\[\[_TOC_\]\])\s*$/i;
const QUOTE = /^ {0,3}>\s?/;
const LIST_ITEM = /^(\s*)([*+-]|\d{1,9}[.)])\s+(.*)$/;
export const TASK = /^\[([ xX])\]\s+/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const HTML_COMMENT = /^\s*<!--[\s\S]*-->\s*$/;
const HARD_BREAK = /(?: {2,}|\\)$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:\s+(.*)$/;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\]/g;

const LINKABLE_URL = /^(?:https?:|mailto:|#)/i;
const BARE_URL = /\bhttps?:\/\/[^\s<>\u{E000}-\u{E002}]*[^\s<>.,:;"'!?)\]*_~\u{E000}-\u{E002}]/gu;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
const LINK = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_IMAGE = /<img\b[^>]*>/gi;
const HTML_LINK = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HTML_FORMAT = /<(\/?)(b|strong|i|em|s|del|strike|sub|sup)>/gi;
const HTML_BREAK = /<br\s*\/?>\s*/gi;
// Layout wrappers like README's centered paragraphs, their content stays
const HTML_LAYOUT = /<\/?(?:p|div|span|picture|source|center|details|summary|h[1-6])\b[^>]*>/gi;
const ANY_HTML_TAG = /<\/?[a-z][^>]*>/gi;
const HTML_FORMAT_NAMES = Object.freeze({strong: 'b', em: 'i', del: 's', strike: 's'});

// Private-use characters hold the already converted inline parts while the
// rest of the line is escaped, so nothing from the document becomes markup.
// The third marks a footnote reference after its label became its number.
const SLOT_OPEN = '\u{E000}';
const SLOT_CLOSE = '\u{E001}';
const NOTE_MARK = '\u{E002}';
const NOTE_REF = /\u{E002}(\d+)\u{E002}/gu;

const MAX_CODEPOINT = 0x10ffff;

export function parseMarkdown(markdown) {
    const {lines, notes} = extractFootnotes(String(markdown ?? '').replace(/\r/g, '').split('\n'));
    const contents = {type: 'list', items: []};
    const blocks = parseBlocks(lines, contents);
    const headings = blocks.filter(block => block.type === 'heading');
    assignIds(headings);
    contents.items.push(...contentsItems(headings));
    if (!notes.length)
        return blocks;
    const noteItems = notes.map((text, i) => ({level: 0, marker: `${i + 1}.`, text, id: `fn-${i + 1}`}));
    return [...blocks, {type: 'rule'}, {type: 'list', items: noteItems}];
}

function extractFootnotes(lines) {
    const isCode = codeLineFlags(lines);
    const notes = new Map();
    const kept = [];
    let openLabel = null;
    lines.forEach((line, i) => {
        const definition = !isCode[i] && line.match(FOOTNOTE_DEFINITION);
        if (definition) {
            openLabel = definition[1];
            notes.set(openLabel, definition[2]);
            return;
        }
        if (openLabel && line.trim() && INDENTED_CODE.test(line)) {
            notes.set(openLabel, `${notes.get(openLabel)} ${line.trim()}`);
            return;
        }
        openLabel = null;
        kept.push([line, isCode[i]]);
    });
    const numbers = new Map([...notes.keys()].map((label, i) => [label, i + 1]));
    const markRefs = line => line.replace(FOOTNOTE_REF, (match, label) =>
        numbers.has(label) ? `${NOTE_MARK}${numbers.get(label)}${NOTE_MARK}` : match);
    return {
        lines: kept.map(([line, isCodeLine]) => isCodeLine ? line : markRefs(line)),
        notes: [...notes.values()].map(markRefs),
    };
}

function codeLineFlags(lines) {
    let fence = null;
    return lines.map(line => {
        if (fence) {
            if (line.trimStart().startsWith(fence))
                fence = null;
            return true;
        }
        fence = line.match(FENCE)?.[1] ?? null;
        return Boolean(fence);
    });
}

function parseBlocks(lines, contents) {
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
            end = readFence(lines, i, blocks);
        else if (INDENTED_CODE.test(line) && !isAfterList)
            end = readIndentedCode(lines, i, blocks);
        else if (HEADING.test(line))
            end = readHeading(lines, i, blocks);
        else if (RULE.test(line))
            end = push(blocks, {type: 'rule'}, i + 1);
        else if (CONTENTS.test(line))
            end = push(blocks, contents, i + 1);
        else if (isTableStart(lines, i))
            end = readTable(lines, i, blocks);
        else if (QUOTE.test(line))
            end = readQuote(lines, i, blocks, contents);
        else if (LIST_ITEM.test(line))
            end = readList(lines, i, blocks);
        else
            end = readParagraph(lines, i, blocks);
        i = end;
    }
    return blocks;
}

function push(blocks, block, next) {
    blocks.push(block);
    return next;
}

function readFence(lines, start, blocks) {
    const [, fence, lang] = lines[start].match(FENCE);
    const body = [];
    let i = start + 1;
    while (i < lines.length && !lines[i].trimStart().startsWith(fence))
        body.push(lines[i++]);
    return push(blocks, {type: 'code', text: body.join('\n'), lang}, i + 1);
}

function readIndentedCode(lines, start, blocks) {
    const body = [];
    let i = start;
    while (i < lines.length && (INDENTED_CODE.test(lines[i]) || !lines[i].trim()))
        body.push(lines[i++].replace(INDENTED_CODE, ''));
    return push(blocks, {type: 'code', text: body.join('\n').trimEnd()}, i);
}

function readHeading(lines, start, blocks) {
    const [, marks, text = ''] = lines[start].match(HEADING);
    return push(blocks, {type: 'heading', level: marks.length, text}, start + 1);
}

function isTableStart(lines, i) {
    return lines[i].includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]) &&
        lines[i + 1].includes('-');
}

function readTable(lines, start, blocks) {
    const aligns = tableCells(lines[start + 1]).map(cell => {
        if (cell.startsWith(':') && cell.endsWith(':'))
            return 0.5;
        return cell.endsWith(':') ? 1 : 0;
    });
    const rows = [tableCells(lines[start])];
    let i = start + 2;
    while (i < lines.length && lines[i].includes('|') && lines[i].trim())
        rows.push(tableCells(lines[i++]));
    return push(blocks, {type: 'table', aligns, rows}, i);
}

function tableCells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim());
}

// One quote level is stripped and the rest parsed again, so a quote inside
// a quote nests one indent deeper.
function readQuote(lines, start, blocks, contents) {
    const inner = [];
    let i = start;
    while (i < lines.length && QUOTE.test(lines[i]))
        inner.push(lines[i++].replace(QUOTE, ''));
    return push(blocks, {type: 'quote', blocks: parseBlocks(inner, contents)}, i);
}

function readList(lines, start, blocks) {
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
            if (isTopLevel && items.length && isOrdered(item[2]) !== isOrdered(items[0].marker))
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
            items.at(-1).text = `${joinLine(items.at(-1).text)}${line.trim()}`;
            continue;
        }
        const nextIsItem = !line.trim() && LIST_ITEM.test(lines[i + 1] ?? '');
        if (!nextIsItem)
            break;
    }
    return push(blocks, {type: 'list', items}, i);
}

export function isOrdered(marker) {
    return /\d/.test(marker);
}

function readParagraph(lines, start, blocks) {
    let text = lines[start].trimStart();
    let i = start + 1;
    for (; i < lines.length; i++) {
        const line = lines[i];
        const startsBlock = !line.trim() || FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) ||
            LIST_ITEM.test(line) || RULE.test(line);
        if (startsBlock)
            break;
        text = `${joinLine(text)}${line.trimStart()}`;
    }
    text = text.replace(HARD_BREAK, '').trimEnd();
    const htmlHeading = text.match(HTML_HEADING);
    if (htmlHeading)
        return push(blocks, {type: 'heading', level: Number(htmlHeading[1]), text: htmlHeading[2].trim()}, i);
    return push(blocks, {type: 'paragraph', text}, i);
}

// Two trailing spaces or a backslash end the line hard, anything else is a
// soft break that joins with a space.
function joinLine(text) {
    return HARD_BREAK.test(text) ? `${text.replace(HARD_BREAK, '')}\n` : `${text.trimEnd()} `;
}

// GitHub's anchor rules, so a hand-written [x](#some-heading) finds its
// heading the same way it does on github.com
function assignIds(headings) {
    const seen = new Map();
    for (const heading of headings) {
        const slug = plainText(heading.text).trim().toLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
        const count = seen.get(slug) ?? 0;
        seen.set(slug, count + 1);
        heading.id = count ? `${slug}-${count}` : slug;
    }
}

function plainText(text) {
    return decodeEntities(unwrapLinks(text).replace(ANY_HTML_TAG, '').replace(NOTE_REF, ''));
}

// A link can't sit inside the contents entry that links to its heading
function contentsItems(headings) {
    const topLevel = Math.min(...headings.map(heading => heading.level));
    return headings.map(({level, text, id}) => ({
        level: level - topLevel,
        marker: '-',
        text: `[${unwrapLinks(text).replace(NOTE_REF, '').replace(/[[\]]/g, '\\$&')}](#${id})`,
    }));
}

function unwrapLinks(text) {
    return text.replace(IMAGE, '$1').replace(LINK, '$1');
}

// Headings need the inline pass too, release-please puts the compare link
// right inside the version heading. The dialect turns escaped text into Pango
// markup for prefs or HTML for the page.
export function inlineMarkup(text, dialect) {
    const slots = [];
    const keep = markup => `${SLOT_OPEN}${slots.push(markup) - 1}${SLOT_CLOSE}`;
    let markup = convertInline(text.replace(/[\u{E000}\u{E001}]/gu, ''), dialect, keep, true);
    // A code span can hold an escaped character, so its slot holds a slot
    while (markup.includes(SLOT_OPEN))
        markup = markup.replace(/\u{E000}(\d+)\u{E001}/gu, (_match, index) => slots[index]);
    return markup;
}

// A link label runs through here again without links, nested anchors are
// invalid in both Pango and HTML
function convertInline(text, dialect, keep, allowLinks) {
    const {escape, codeSpan, linkOpen, image} = dialect;
    const escapeText = raw => escape(decodeEntities(raw));
    // Relative links point into a repository the viewer isn't showing, their
    // label stays as text
    const link = (url, label) => {
        const inner = convertInline(label, dialect, keep, false);
        const isLinkable = allowLinks && LINKABLE_URL.test(url);
        return keep(isLinkable ? `${linkOpen(escape(url))}${inner}</a>` : inner);
    };
    const urlLink = url => keep(allowLinks ? `${linkOpen(escape(url))}${escape(url)}</a>` : escape(url));

    const protectedText = text
        .replace(/\\([!-/:-@[-`{-~])/g, (_match, char) => keep(escape(char)))
        .replace(/(`+)(.+?)\1(?!`)/g, (_match, _ticks, code) => keep(codeSpan(escape(code.trim()))))
        .replace(/<((?:https?|mailto):[^\s<>]+)>/g, (_match, url) => urlLink(url))
        .replace(IMAGE, (_match, alt, src) => keep(image(escape(src), escapeText(alt))))
        // An html image keeps its width, README sizes its logo and icon that way
        .replace(HTML_IMAGE, tag => keep(image(escape(htmlAttribute(tag, 'src')), escapeText(htmlAttribute(tag, 'alt')),
            Number.parseInt(htmlAttribute(tag, 'width'), 10) || 0)))
        .replace(LINK, (_match, label, url) => link(url, label))
        .replace(HTML_LINK, (_match, attributes, label) => link(htmlAttribute(attributes, 'href'), label))
        .replace(NOTE_REF, (_match, number) =>
            keep(`<sup>${linkOpen(`#fn-${number}`)}${number}</a></sup>`))
        .replace(HTML_FORMAT, (_match, slash, name) => {
            const tag = name.toLowerCase();
            return keep(`<${slash}${HTML_FORMAT_NAMES[tag] ?? tag}>`);
        })
        .replace(HTML_BREAK, () => keep('\n'))
        .replace(HTML_LAYOUT, '')
        .replace(BARE_URL, urlLink);

    return escapeText(protectedText)
        .replace(/\*\*\*(?=\S)(.*?\S)\*\*\*/g, '<b><i>$1</i></b>')
        .replace(/\*\*(?=\S)(.*?\S)\*\*/g, '<b>$1</b>')
        .replace(/(^|\W)__(?=\S)(.*?\S)__(?!\w)/g, '$1<b>$2</b>')
        .replace(/\*(?=\S)(.*?\S)\*/g, '<i>$1</i>')
        .replace(/(^|\W)_(?=\S)(.*?\S)_(?!\w)/g, '$1<i>$2</i>')
        .replace(/~~(?=\S)(.*?\S)~~/g, '<s>$1</s>')
        .replace(/\^([^\s^]+)\^/g, '<sup>$1</sup>')
        .replace(/~([^\s~]+)~/g, '<sub>$1</sub>');
}

function htmlAttribute(tag, name) {
    return decodeEntities(tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? '');
}

function decodeEntities(text) {
    return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name) => {
        if (name.startsWith('#')) {
            const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return code > 0 && code <= MAX_CODEPOINT ? String.fromCodePoint(code) : match;
        }
        return ENTITIES[name.toLowerCase()] ?? match;
    });
}
