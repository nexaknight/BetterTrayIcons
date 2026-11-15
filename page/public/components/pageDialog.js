import {dialogMarkup, trapFocus} from './dialog.js';
import {holdPage, releasePage} from './modalScroll.js';
import {iconButton} from './icon.js';
import {ui} from '../shared/store.js';
import {_} from '../shared/i18n.js';

/**
 * Opens a dialog over the whole page in the prefs dialog shell, for the
 * landing page's own dialogs. Close button, Escape and a click outside close it.
 *
 * @param {object} options Title, extra class, the element focus returns to and a close callback.
 * @returns {object} The host element, a body setter and close().
 */
export function openPageDialog({title, className = '', opener = null, onClose = () => {}}) {
    const host = document.createElement('div');
    host.className = 'prefs-native page-dialog-host';
    const close = iconButton('close', _('Close'), 'data-page-dialog-close', 'close');
    host.innerHTML = dialogMarkup({title, end: close, className: `page-dialog ${className}`});
    document.body.append(host);
    holdPage(host, () => host.querySelector('.pref-dialog'));
    const body = host.querySelector('.pref-dialog-body');
    const dialog = {
        host,
        setBody: markup => (body.innerHTML = markup),
        close: () => {
            if (!host.isConnected)
                return;
            host.remove();
            releasePage(host);
            onClose();
            opener?.focus({preventScroll: true});
        },
    };
    host.addEventListener('click', event => {
        if (event.target === host || event.target.closest('[data-page-dialog-close]'))
            dialog.close();
    });
    host.addEventListener('keydown', event => {
        // An open dropdown takes Escape for itself
        if (event.key === 'Escape' && !ui.dropdownPopover) {
            event.preventDefault();
            dialog.close();
            return;
        }
        if (event.key === 'Tab')
            trapFocus(event, [...host.querySelectorAll('button,a[href],iframe')]);
    });
    host.querySelector('[data-page-dialog-close]').focus({preventScroll: true});
    return dialog;
}
