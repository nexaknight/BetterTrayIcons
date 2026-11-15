import {closeDropdown} from './popover.js';
import {syncInert} from './sidebar.js';
import {alertLayer} from './window.js';
import {_} from '../shared/i18n.js';
import {ui} from '../shared/store.js';
import {escapeHtml} from '../shared/util.js';
import {buttonMarkup} from './button.js';

export function openAlert({heading, body: message, confirmLabel, onConfirm}) {
    closeDropdown();
    ui.alert = {onConfirm, opener: document.activeElement};
    alertLayer.innerHTML = '<section class="pref-dialog pref-alert" role="alertdialog" aria-modal="true" aria-labelledby="pref-alert-heading" aria-describedby="pref-alert-message">' +
        `<h2 id="pref-alert-heading">${escapeHtml(heading)}</h2><p id="pref-alert-message">${escapeHtml(message)}</p>` +
        `<div class="pref-alert-actions">${buttonMarkup({title: _('Cancel'), attributes: 'data-alert-cancel'})}` +
        `${buttonMarkup({variant: 'destructive', title: confirmLabel, attributes: 'data-alert-confirm'})}</div></section>`;
    alertLayer.hidden = false;
    syncInert();
    alertLayer.querySelector('[data-alert-cancel]').focus({preventScroll: true});
}

export function closeAlert() {
    const {opener} = ui.alert;
    ui.alert = null;
    alertLayer.hidden = true;
    alertLayer.replaceChildren();
    syncInert();
    if (opener.isConnected)
        opener.focus({preventScroll: true});
}

export function confirmAlert() {
    const {onConfirm} = ui.alert;
    closeAlert();
    onConfirm();
}
