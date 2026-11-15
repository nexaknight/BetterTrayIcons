import {icon, iconButton} from './icon.js';
import {_} from '../shared/i18n.js';
import {escapeHtml} from '../shared/util.js';
import {reducedMotion} from '../landing/elements.js';
import {BULLETS, HEADING_CLASSES, TASK, TASK_DONE, TASK_OPEN, inlineMarkup, isOrdered, parseMarkdown} from '../../../src/shared/markdownParse.js';

// A port of src/prefs/components/markdown.js. Pango markup becomes HTML and
// each GTK widget becomes an element with the same spacing in
// styles/prefs/_markdown.scss.

const COPIED_MS = 1500;
const TAG = /<(\/?)([a-z]+)[^>]*>/g;
const VOID_TAGS = new Set(['img']);
const ANY_TAG = /<[^>]*>/g;
const HIDDEN_FIELD_CSS = 'position:fixed;opacity:0;pointer-events:none';
const ALIGNS = {0: 'left', 0.5: 'center', 1: 'right'};
const DIALOG_BODY_SELECTOR = '.pref-dialog-body';

let viewCount = 0;

export function createMarkdownView(markdown, header = '') {
    return createBlocksView(parseMarkdown(markdown), header);
}

// Ids carry a per-view prefix, the changelog shows several documents on one
// page and each has its own headings
export function createBlocksView(blocks, header = '') {
    const dialect = htmlDialect(`md${++viewCount}-`);
    const markup = blocks.map(block => renderBlock(block, dialect)).join('');
    return `<div class="pref-md-view">${header ? createText(header) : ''}${markup}</div>`;
}

// GtkLabel opens links in the browser, a new tab is the page's equivalent
function htmlDialect(idPrefix) {
    return {
        idPrefix,
        escape: escapeHtml,
        codeSpan: code => `<code class="pref-md-chip">${code}</code>`,
        linkOpen: href => href.startsWith('#')
            ? `<a href="#${idPrefix}${href.slice(1)}">`
            : `<a href="${href}" target="_blank" rel="noopener">`,
        image: (src, alt, width) =>
            `<img class="pref-md-image" src="${src}" alt="${alt}"${width ? ` width="${width}"` : ''} loading="lazy">`,
    };
}

function renderBlock(block, dialect) {
    switch (block.type) {
    case 'heading':
        return renderHeading(block, dialect);
    case 'code':
        return renderCode(block);
    case 'quote':
        return renderQuote(block.blocks, dialect);
    case 'list':
        return renderList(block.items, dialect);
    case 'rule':
        return '<hr class="pref-md-rule">';
    case 'table':
        return renderTable(block, dialect);
    default:
        return createText(inlineMarkup(block.text, dialect));
    }
}

function renderHeading({level, text, id}, dialect) {
    const anchor = id ? ` id="${dialect.idPrefix}${id}"` : '';
    return `<p class="pref-md-text pref-md-${HEADING_CLASSES[level - 1]}" role="heading" aria-level="${level}"${anchor}>` +
        `${validMarkup(inlineMarkup(text, dialect))}</p>`;
}

function renderCode({text, lang}) {
    const label = lang ? `<span class="pref-md-code-lang">${escapeHtml(lang)}</span>` : '';
    return createScroller(`${label}<pre class="pref-md-code-block">${escapeHtml(text)}</pre>${copyButton()}`, 'pref-md-code');
}

// A copy button on every code block, the demo's own addition to the viewer
function copyButton() {
    return iconButton('copy', _('Copy'), 'data-md-copy', 'flat pref-md-copy');
}

function renderQuote(blocks, dialect) {
    return `<div class="pref-md-quote">${blocks.map(block => renderBlock(block, dialect)).join('')}</div>`;
}

function renderList(items, dialect) {
    const rows = items.map(({level, marker, text, id}) => {
        const task = text.match(TASK);
        let symbol = isOrdered(marker) ? escapeHtml(marker) : BULLETS[level % BULLETS.length];
        if (task)
            symbol = task[1] === ' ' ? TASK_OPEN : TASK_DONE;
        const anchor = id ? ` id="${dialect.idPrefix}${id}"` : '';
        return `<div class="pref-md-list-row" style="--md-level:${level}"${anchor}>` +
            `<span class="pref-md-marker">${symbol}</span>${createText(inlineMarkup(task ? text.replace(TASK, '') : text, dialect))}</div>`;
    }).join('');
    return `<div class="pref-md-list">${rows}</div>`;
}

// A grid rather than a monospace block, so the cells keep the proportional
// font and their inline formatting while the columns still line up.
function renderTable({aligns, rows}, dialect) {
    const columns = Math.max(...rows.map(cells => cells.length));
    const cells = rows.flatMap((row, rowIndex) => row.map((cell, column) => {
        const markup = inlineMarkup(cell, dialect);
        const align = ALIGNS[aligns[column] ?? 0];
        return `<span class="pref-md-text pref-md-cell" style="grid-area:${rowIndex + 1}/${column + 1};text-align:${align}">` +
            `${validMarkup(rowIndex === 0 ? `<b>${markup}</b>` : markup)}</span>`;
    })).join('');
    return createScroller(`<div class="pref-md-table" style="--md-columns:${columns}">${cells}</div>`);
}

function createScroller(child, className = '') {
    return `<div class="pref-md-scroller ${className}">${child}</div>`;
}

function createText(markup) {
    return `<p class="pref-md-text">${validMarkup(markup)}</p>`;
}

// Emphasis markers that cross each other produce tags Pango refuses, the
// label would then show nothing, so such a line falls back to its plain text.
// A browser would repair the tags instead, the check keeps the prefs result.
function validMarkup(markup) {
    const open = [];
    for (const [, closing, name] of markup.matchAll(TAG)) {
        if (VOID_TAGS.has(name))
            continue;
        if (!closing)
            open.push(name);
        else if (open.pop() !== name)
            return markup.replace(ANY_TAG, '');
    }
    return open.length ? markup.replace(ANY_TAG, '') : markup;
}

// Bound once on the document, the dialogs that show markdown come and go
export function bindMarkdownViews() {
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-md-copy]');
        if (button)
            copyCode(button);
        const anchor = event.target.closest('.pref-md-view a[href^="#"]');
        if (anchor)
            scrollToAnchor(event, anchor);
    });
}

// Only the dialog body scrolls, scrollIntoView would move the page behind
// it too, and the address bar keeps its hash
function scrollToAnchor(event, anchor) {
    event.preventDefault();
    const target = document.getElementById(anchor.getAttribute('href').slice(1));
    if (!target)
        return;
    const scroller = target.closest(DIALOG_BODY_SELECTOR);
    const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({top, behavior: reducedMotion.matches ? 'auto' : 'smooth'});
}

async function copyCode(button) {
    const text = button.parentElement.querySelector('.pref-md-code-block').textContent;
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        copyThroughSelection(text);
    }
    showCopied(button);
}

// Browsers without the async clipboard, or a page without permission for it
function copyThroughSelection(text) {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = HIDDEN_FIELD_CSS;
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
}

function showCopied(button) {
    const label = isCopied => isCopied ? _('Copied') : _('Copy');
    const paint = isCopied => {
        button.innerHTML = icon(isCopied ? 'select' : 'copy');
        button.setAttribute('aria-label', label(isCopied));
        button.dataset.prefTooltip = label(isCopied);
    };
    paint(true);
    clearTimeout(button.copiedTimer);
    button.copiedTimer = setTimeout(() => paint(false), COPIED_MS);
}
