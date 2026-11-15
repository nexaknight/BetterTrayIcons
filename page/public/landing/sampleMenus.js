import {closeAppWindow, isAppWindowOpen, openAppWindow, toggleAppWindow} from '../components/appWindow.js';
import {displayName, quitApp, quitBackgroundApp} from '../shared/apps.js';
import {refreshApps} from '../components/quickSettings.js';
import {_} from '../shared/i18n.js';
import {views} from '../shared/views.js';

// One line an app would plausibly add to its own tray menu
const APP_ITEMS = {
    discord: _('Check for Updates…'),
    steam: _('Library'),
    telegram: _('New Message…'),
    cloud: _('Open Sync Folder'),
    signal: _('New Group…'),
    vlc: _('Play'),
    obs: _('Start Recording'),
    remmina: _('Quick Connect…'),
};

// Mute is remembered per app while the page is open, like a checkmark item
// the app keeps in its dbusmenu layout
const mutedApps = new Set();

export function sampleMenu(app, button) {
    if (app.isBackgroundProxy)
        return proxyMenu(app, button);
    if (app.isXembed)
        return win32Menu(app, button);
    const isOpen = isAppWindowOpen(app);
    return [
        {label: (isOpen ? _('Hide %1') : _('Show %1')).replace('%1', displayName(app)), onActivate: () => toggleAppWindow(app, button)},
        {label: APP_ITEMS[app.id], onActivate: () => openAppWindow(app, button)},
        {separator: true},
        {label: _('Mute Notifications'), isChecked: mutedApps.has(app.id), onActivate: () => toggleMuted(app)},
        {label: _('Connected'), isDisabled: true},
        {separator: true},
        {label: _('Quit %1').replace('%1', displayName(app)), onActivate: () => quitFromMenu(app)},
    ];
}

// fillBackgroundAppMenu in src/shell/backgroundAppsProxy/backgroundAppsProxyIcon.js,
// the portal message as the status line, then the desktop actions (Pika has
// none), Show and Quit
function proxyMenu(app, button) {
    const quit = () => {
        closeAppWindow(app);
        quitBackgroundApp();
        refreshApps();
    };
    return [
        {label: app.message ?? _('Running in the background'), isDisabled: true},
        {separator: true},
        {label: _('Show'), onActivate: () => openAppWindow(app, button)},
        {label: _('Quit'), onActivate: quit},
    ];
}

// The menu a Win32 app pops up itself, the tray only hands it the click
function win32Menu(app, button) {
    return [
        {label: _('Open %1').replace('%1', app.name), onActivate: () => openAppWindow(app, button)},
        {separator: true},
        {label: _('Exit'), onActivate: () => quitFromMenu(app)},
    ];
}

function toggleMuted(app) {
    if (mutedApps.has(app.id))
        mutedApps.delete(app.id);
    else
        mutedApps.add(app.id);
}

// The icon leaves the panel, popup, drawer and Quick Settings until the reload
function quitFromMenu(app) {
    closeAppWindow(app);
    quitApp(app);
    refreshApps();
    views.renderPage(true);
}
