import {dialogMarkup, onModalKey} from './dialog.js';
import {group} from './group.js';
import {icon, iconButton} from './icon.js';
import {row} from './row.js';
import {appIconMarkup, displayName} from '../shared/apps.js';
import {escapeHtml} from '../shared/util.js';
import {_} from '../shared/i18n.js';

let current = null;

// A second activate while it is open hides it again, what an app that hides
// to the tray does when its icon is clicked in front
export function toggleAppWindow(app, opener) {
    if (isAppWindowOpen(app))
        closeAppWindow();
    else
        openAppWindow(app, opener);
}

export function isAppWindowOpen(app) {
    return current?.app === app;
}

export function openAppWindow(app, opener) {
    if (isAppWindowOpen(app))
        return;
    closeAppWindow();
    const desktopElement = opener.closest('#desktop');
    const host = document.createElement('div');
    host.className = 'prefs-native app-window-host';
    host.innerHTML = windowMarkup(app);
    // The window opens below the top bar, as a maximized app does
    const panel = desktopElement.querySelector('.panel');
    host.style.top = `${panel.offsetTop + panel.offsetHeight}px`;
    desktopElement.append(host);
    current = {app, host, opener};
    host.addEventListener('click', onHostClick);
    host.addEventListener('keydown', event => onModalKey(event, host, closeAppWindow));
    host.querySelector('[data-app-window-close]').focus({preventScroll: true});
}

function windowMarkup(app) {
    const name = escapeHtml(displayName(app));
    const title = `<span class="app-window-title"><span class="app-window-icon" style="color:${app.color}">${appIconMarkup(app, 'aria-hidden="true"')}</span>${name}</span>`;
    const close = iconButton('close', _('Close %1').replace('%1', displayName(app)), 'data-app-window-close', 'close');
    const rows = row(_('Nothing new'), _('You are all caught up.'), '', icon('other')) +
        row(_('Sample window'), _('Stands in for the window of %1 on this page.').replace('%1', name), '', icon('about'));
    return dialogMarkup({title: displayName(app), end: close, body: group('', rows), className: 'app-window', titleWidget: title});
}

export function closeAppWindow(app = current?.app) {
    if (!current || current.app !== app)
        return;
    const {host, opener} = current;
    current = null;
    host.remove();
    if (opener.isConnected)
        opener.focus({preventScroll: true});
}

function onHostClick(event) {
    const isOutside = event.target === current.host;
    if (isOutside || event.target.closest('[data-app-window-close]'))
        closeAppWindow();
}
