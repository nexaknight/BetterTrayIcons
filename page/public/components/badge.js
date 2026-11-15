import {escapeHtml} from '../shared/util.js';

export function badge(text, variant = 'warning', {className = '', suffix = ''} = {}) {
    return `<span class="pref-badge ${variant} ${className}">${escapeHtml(text)}${suffix}</span>`;
}
