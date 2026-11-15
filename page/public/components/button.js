import {escapeHtml} from '../shared/util.js';

// The variant is the class that carries the look, so each look stays in the
// CSS it already lives in
export function buttonMarkup({variant = '', title = '', subtitle = '', textClass = '', leading = '', trailing = '', label = '', attributes = ''} = {}) {
    const classAttribute = variant.trim() ? ` class="${variant.trim()}"` : '';
    const labelAttribute = label ? ` aria-label="${escapeHtml(label)}"` : '';
    return `<button type="button"${classAttribute}${labelAttribute} ${attributes}>${leading}${buttonText(title, subtitle, textClass)}${trailing}</button>`;
}

function buttonText(title, subtitle, textClass) {
    if (!textClass)
        return title;
    const subtitleMarkup = subtitle ? `<small>${subtitle}</small>` : '';
    return `<span class="${textClass}"><strong>${title}</strong>${subtitleMarkup}</span>`;
}

export function createButton(options) {
    const template = document.createElement('template');
    template.innerHTML = buttonMarkup(options);
    return template.content.firstElementChild;
}

// createButton in src/prefs/components/button.js with a text label
export function smallButton(label, attributes = '', variant = '') {
    return buttonMarkup({variant: `pref-small-button ${variant}`, title: label, attributes});
}
