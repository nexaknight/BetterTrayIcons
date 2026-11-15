import {_} from '../shared/i18n.js';
import {repoIconUrl} from '../shared/iconValues.js';
import {escapeHtml} from '../shared/util.js';
import {buttonMarkup} from './button.js';

export const CHEVRON = icon('next', 'pref-chevron');

export function icon(name, className = '') {
    return `<span class="pref-icon ${className}" aria-hidden="true" style="--pref-icon:url('${repoIconUrl(name)}')"></span>`;
}

// Adwaita's close buttons carry no tooltip, the label is for screen readers only
export function iconButton(name, label, attributes = '', className = '') {
    const tooltip = name === 'close' ? '' : `data-pref-tooltip="${escapeHtml(shortTooltip(name, label))}"`;
    return buttonMarkup({variant: `pref-icon-button ${className}`, leading: icon(name), label, attributes: `${tooltip} ${attributes}`});
}

function shortTooltip(name, label) {
    if (name === 'gear')
        return _('Configure');
    if (name === 'reset')
        return _('Reset');
    return label;
}

export function gearButton(label, attributes, className = '') {
    return iconButton('gear', label, attributes, className);
}

