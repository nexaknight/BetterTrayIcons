import {_} from '../shared/i18n.js';
import {icon} from './icon.js';
import {openPopover} from './popover.js';
import {buttonMarkup} from './button.js';

export function openHeaderMenu(button) {
    const item = (iconName, label, kind) =>
        buttonMarkup({leading: icon(iconName), title: `<span>${label}</span>`, attributes: `role="menuitem" data-native-reset="${kind}"`});
    const popover = openPopover(button, item('trash', _('Forget All Apps'), 'apps-forget') + item('reset', _('Reset All Apps'), 'apps-reset'), 'menu', 'pref-menu');
    popover?.querySelector('[role=menuitem]').focus({preventScroll: true});
}
