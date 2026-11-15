import {icon} from './icon.js';
import {openPopover} from './popover.js';
import {_} from '../shared/i18n.js';
import {escapeHtml} from '../shared/util.js';
import {buttonMarkup} from './button.js';

// A popover and no tooltip, as createHelpButton in src/prefs/components/button.js
export function helpButton(text, isCompact = false) {
    return buttonMarkup({variant: `pref-icon-button pref-help ${isCompact ? 'compact' : ''}`, leading: icon('help'), label: _('Help'), attributes: `aria-haspopup="dialog" aria-expanded="false" data-help="${escapeHtml(text)}"`});
}

export function openHelp(button) {
    const text = escapeHtml(button.dataset.help).replaceAll('\n', '<br>');
    const popover = openPopover(button, `<p class="pref-help-text" tabindex="-1">${text}</p>`, 'dialog', 'pref-help-popover');
    popover?.querySelector('p').focus({preventScroll: true});
}
