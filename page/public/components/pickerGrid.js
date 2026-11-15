import {_} from '../shared/i18n.js';
import {icon} from './icon.js';
import {iconUrl} from '../shared/iconValues.js';
import {escapeHtml} from '../shared/util.js';
import {buttonMarkup} from './button.js';

// A port of SectionGrid in src/prefs/components/iconEmojiPicker.js
export const COLUMNS = 14;
export const MODE_EMOJI = 'emoji';
const ICONS_PER_FRAME = 26;
const FOCUS_STEPS = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS};
const SCROLL_SETTLE_MS = 100;
const LAZY_LOAD_MARGIN = '80px';

export function pickerTab(title, iconName, attributes) {
    return buttonMarkup({variant: 'pref-picker-tab', leading: icon(iconName), label: title, attributes: `${attributes} data-pref-tooltip="${escapeHtml(title)}" aria-pressed="false"`});
}

export class SectionGrid {
    constructor({kind, current, onPick, searchPlaceholder, emptyTitle, showTabs = true}) {
        this._kind = kind;
        this._current = current;
        this._onPick = onPick;
        this._sections = [];
        this._query = '';
        this._showTabs = showTabs;
        this._queue = new Set();
        this._frame = 0;
        this._lastScroll = 0;
        this.element = document.createElement('div');
        this.element.className = 'pref-picker-grid-box';
        this.element.innerHTML = `<div class="pref-picker-tabs" ${showTabs ? '' : 'hidden'}></div>` +
            `<span class="pref-picker-search-entry">${icon('search')}<input class="pref-input pref-picker-search" type="search" placeholder="${escapeHtml(searchPlaceholder)}" aria-label="${escapeHtml(searchPlaceholder)}"></span>` +
            '<div class="pref-picker-scroller pref-scroll-list"><div class="pref-picker-grid" role="grid"></div></div>' +
            `<div class="pref-status-page compact" hidden>${icon('search')}<h2>${escapeHtml(emptyTitle)}</h2><p>${_('Try a different search term.')}</p></div>`;
        this._tabBar = this.element.querySelector('.pref-picker-tabs');
        this._scroller = this.element.querySelector('.pref-picker-scroller');
        this._grid = this.element.querySelector('.pref-picker-grid');
        this._empty = this.element.querySelector('.pref-status-page');
        this._observer = new IntersectionObserver(entries => this._onCellsShown(entries), {root: this._scroller, rootMargin: LAZY_LOAD_MARGIN});
        this.element.querySelector('.pref-picker-search').addEventListener('input', event => {
            this._query = event.target.value.trim().toLowerCase();
            this._render();
            this._scroller.scrollTop = 0;
        });
        this._scroller.addEventListener('scroll', () => {
            this._lastScroll = performance.now();
            this._syncToScroll();
        });
        this._grid.addEventListener('click', event => this._onClick(event));
        this._tabBar.addEventListener('click', event => this._onTab(event));
    }

    setSections(sections) {
        this._sections = sections;
        this._tabBar.innerHTML = sections.map(section => pickerTab(section.title, section.iconName, `data-section="${section.id}"`)).join('');
        this._render();
    }

    // One row of context stays above the current item
    scrollToValue(value) {
        const cell = this._grid.querySelector(`[data-value="${CSS.escape(value ?? '')}"]`);
        if (cell)
            this._scroller.scrollTop = Math.max(0, cell.offsetTop - this._grid.offsetTop - cell.offsetHeight * 2);
        this._syncToScroll();
    }

    // Arrow keys walk the cells as GtkGridView does, a row is the column count
    moveFocus(key) {
        const cells = [...this._grid.querySelectorAll('.pref-picker-cell')];
        const index = cells.indexOf(document.activeElement);
        if (index < 0)
            return false;
        const step = FOCUS_STEPS[key];
        const target = cells[Math.min(cells.length - 1, Math.max(0, index + step))];
        target.focus();
        target.scrollIntoView({block: 'nearest'});
        return true;
    }

    // Words match from their start, so cat skips communication and an icon's
    // dashes count as word breaks
    _render() {
        const needle = ` ${this._query}`;
        let markup = '';
        for (const section of this._sections) {
            const items = this._query ? section.items.filter(item => item.search.includes(needle)) : section.items;
            this._tabBar.querySelector(`[data-section="${section.id}"]`).toggleAttribute('disabled', items.length === 0);
            if (items.length === 0)
                continue;
            markup += `<h4 class="pref-picker-title" data-section="${section.id}">${escapeHtml(section.title)}</h4>${
                items.map(item => this._cellMarkup(item, section)).join('')}`;
        }
        this._grid.innerHTML = markup;
        this._empty.hidden = markup !== '';
        this._scroller.hidden = markup === '';
        this._observer.disconnect();
        for (const cell of this._grid.querySelectorAll('[data-lazy]'))
            this._observer.observe(cell);
        this._syncToScroll();
    }

    _cellMarkup(item, section) {
        const isCurrent = item.value === this._current;
        const content = this._kind === MODE_EMOJI
            ? `<span class="pref-picker-emoji">${escapeHtml(item.text)}</span>`
            : `<svg class="bti" aria-hidden="true" data-lazy="${escapeHtml(iconUrl(item.value))}"></svg>`;
        return buttonMarkup({variant: `pref-picker-cell ${isCurrent ? 'current' : ''} ${section.tint ?? ''}`, leading: content, label: item.name, attributes: `data-value="${escapeHtml(item.value)}" data-pref-tooltip="${escapeHtml(item.name)}"`});
    }

    // Thumbnails load a few per frame once scrolling pauses, as the grid's
    // icon queue does, so a flick past hundreds of icons starts no requests
    _onCellsShown(entries) {
        for (const entry of entries) {
            if (entry.isIntersecting)
                this._queue.add(entry.target);
            else
                this._queue.delete(entry.target);
        }
        this._frame ||= requestAnimationFrame(() => this._runQueue());
    }

    _runQueue() {
        this._frame = 0;
        const isScrolling = performance.now() - this._lastScroll < SCROLL_SETTLE_MS;
        const batch = isScrolling ? [] : [...this._queue].slice(0, ICONS_PER_FRAME);
        for (const image of batch) {
            image.style.setProperty('--bti', `url(${image.dataset.lazy})`);
            image.removeAttribute('data-lazy');
            this._observer.unobserve(image);
            this._queue.delete(image);
        }
        if (this._queue.size)
            this._frame = requestAnimationFrame(() => this._runQueue());
    }

    // The active tab is the section whose title last passed the top edge
    _syncToScroll() {
        if (!this._showTabs)
            return;
        const titles = [...this._grid.querySelectorAll('.pref-picker-title')];
        const top = this._scroller.scrollTop + this._grid.offsetTop;
        const isAtEnd = this._scroller.scrollTop >= this._scroller.scrollHeight - this._scroller.clientHeight - 1;
        const passed = titles.filter(title => title.offsetTop <= top + 1);
        const active = isAtEnd ? titles.at(-1) : passed.at(-1) ?? titles[0];
        for (const tab of this._tabBar.children)
            tab.setAttribute('aria-pressed', String(tab.dataset.section === active?.dataset.section));
    }

    _onTab(event) {
        const tab = event.target.closest('[data-section]');
        const title = tab && this._grid.querySelector(`.pref-picker-title[data-section="${tab.dataset.section}"]`);
        if (title)
            this._scroller.scrollTop = title.offsetTop - this._grid.offsetTop;
    }

    _onClick(event) {
        const cell = event.target.closest('[data-value]');
        if (cell)
            this._onPick(cell.dataset.value);
    }

    release() {
        this._observer.disconnect();
        cancelAnimationFrame(this._frame);
    }
}
