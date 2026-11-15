import {groupSection} from './group.js';
import {toolbar} from './toolbar.js';
import {escapeHtml} from '../shared/util.js';

const MODAL_FOCUSABLES = 'button:not(:disabled),input,select,[tabindex="0"]';

export function onModalKey(event, layer, close) {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
    }
    if (event.key === 'Tab')
        trapFocus(event, [...layer.querySelectorAll(MODAL_FOCUSABLES)]);
}

export function trapFocus(event, items) {
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

export function dialogMarkup({title, end, body = '', className = '', attributes = '', titleWidget = ''}) {
    return `<section class="pref-dialog ${className}" ${attributes} role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">` +
        `${toolbar(title, '', end, 'pref-dialog-header', titleWidget)}<div class="pref-dialog-body">${body}</div></section>`;
}

// createAlert in src/prefs/components/dialog.js, same box and variants
export function alertMarkup(text, {variant = 'neutral'} = {}) {
    return groupSection('', `<div class="pref-alert-box ${variant}" role="note">${escapeHtml(text)}</div>`);
}
