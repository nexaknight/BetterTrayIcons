import {_, pageLanguage} from '../shared/i18n.js';

// data-i18n lists what an element of the page carries in English, "html"
// for its content (the default) or attribute names. A content key is the
// markup with its whitespace collapsed, so inline tags stay inside the
// sentence they belong to and the catalog may move them.
export function translateDocument() {
    const root = document.documentElement;
    if (pageLanguage) {
        root.lang = pageLanguage;
        for (const element of document.querySelectorAll('[data-i18n]'))
            translateElement(element);
    }
    // After the swap, so the content keys never carry the hint
    for (const link of document.querySelectorAll('a[target="_blank"]'))
        link.setAttribute('aria-description', _('Opens in a new tab'));
    root.classList.remove('i18n-pending');
}

function translateElement(element) {
    for (const target of (element.dataset.i18n || 'html').split(' ')) {
        if (target === 'html')
            element.innerHTML = _(collapse(element.innerHTML));
        else
            element.setAttribute(target, _(collapse(element.getAttribute(target))));
    }
}

function collapse(text) {
    return text.replace(/\s+/g, ' ').trim();
}
