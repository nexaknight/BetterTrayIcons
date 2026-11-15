import {escapeHtml} from '../shared/util.js';

export function toolbar(title, start = '', end = '', className = '', titleWidget = '') {
    const center = titleWidget || `<span class="ui-toolbar-title pref-header-title">${escapeHtml(title)}</span>`;
    return `<header class="ui-toolbar ${className}"><div class="ui-toolbar-start pref-header-start">${start}</div>` +
        `${center}<div class="ui-toolbar-end pref-header-end">${end}</div></header>`;
}
