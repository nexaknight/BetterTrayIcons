import {icon} from './icon.js';
import {rowCopy} from './row.js';
import {schedulePersist} from '../shared/persist.js';
import {reducedMotion} from '../landing/elements.js';

// Open expanders stay open through a re-render by their id
const openIds = new Set();

// The chevron turns in the same 200ms ease
const SLIDE_TIMING = {duration: 200, easing: 'ease'};

export function expandExpander(id) {
    openIds.add(id);
}

export function openExpanderIds() {
    return [...openIds];
}

// The landing's expanders are static markup, they open in place without a
// slide. The demo's read openIds when they render.
export function restoreExpanders(ids) {
    for (const id of ids) {
        openIds.add(id);
        for (const header of document.querySelectorAll(`[data-expander="${CSS.escape(id)}"]`)) {
            header.setAttribute('aria-expanded', 'true');
            header.parentElement.classList.add('open');
        }
    }
}

// An insensitive header keeps its arrow but takes no clicks or focus
export function expanderMarkup({id, header, body, className = '', headerClass = '', isSensitive = true}) {
    const isOpen = isSensitive && openIds.has(id);
    const control = isSensitive ? `tabindex="0" aria-expanded="${isOpen}" data-expander="${id}"` : 'aria-disabled="true"';
    return `<div class="ui-expander ${className} ${isOpen ? 'open' : ''}">` +
        `<div class="ui-expander-header ${headerClass}" role="button" ${control}>${header}${icon('next', 'ui-expander-arrow')}</div>` +
        `<div class="ui-expander-body">${body}</div></div>`;
}

// AdwExpanderRow, a row whose suffixes sit left of the arrow
export function expanderRow(id, title, subtitle, {prefix = '', suffix = '', rows = '', className = '', hasSuffix = true, isSensitive = true}) {
    const suffixMarkup = hasSuffix ? `<span class="pref-row-suffix">${suffix}</span>` : '';
    const header = `${prefix}${rowCopy(title, subtitle)}${suffixMarkup}`;
    return expanderMarkup({id, header, body: rows, className: `pref-expander ${className}`, headerClass: 'pref-row', isSensitive});
}

// Bound once on the document, the landing and the demo share it. A button
// inside the header keeps its own click.
export function bindExpanders() {
    document.addEventListener('click', event => {
        const header = event.target.closest('[data-expander]');
        const control = event.target.closest('button, a');
        const isOwnButton = control && !control.matches('[data-expander]');
        if (header && !isOwnButton)
            toggle(header);
    });
    document.addEventListener('keydown', event => {
        const isActivation = event.key === 'Enter' || event.key === ' ';
        if (!isActivation || !event.target.matches('[data-expander]'))
            return;
        event.preventDefault();
        toggle(event.target);
    });
}

function toggle(header) {
    const id = header.dataset.expander;
    if (openIds.has(id))
        openIds.delete(id);
    else
        openIds.add(id);
    const isOpen = openIds.has(id);
    const expander = header.parentElement;
    const body = expander.querySelector(':scope > .ui-expander-body');
    const fromHeight = body.getBoundingClientRect().height;
    header.setAttribute('aria-expanded', String(isOpen));
    expander.classList.toggle('open', isOpen);
    schedulePersist();
    if (!reducedMotion.matches)
        slideBody(expander, body, fromHeight, isOpen);
}

// Starts from the height on screen, so a toggle in mid slide turns back
// without a jump. Once the sliding class drops the plain open or closed CSS
// is the end state.
function slideBody(expander, body, fromHeight, isOpen) {
    body.getAnimations().forEach(animation => animation.cancel());
    expander.classList.add('sliding');
    const toHeight = isOpen ? body.scrollHeight : 0;
    const slide = body.animate({height: [`${fromHeight}px`, `${toHeight}px`]}, SLIDE_TIMING);
    slide.onfinish = () => expander.classList.remove('sliding');
}
