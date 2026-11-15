import {iconValueMarkup} from './iconValues.js';
import {state, storedOrder} from './store.js';
import {_} from './i18n.js';

export const apps = [
    {id: 'discord', icon: 'media/page/discord.svg', name: 'Discord', color: '#a2aaff', packaging: 'Flatpak', unread: 3},
    {id: 'steam', icon: 'media/page/steam.svg', name: 'Steam', color: '#f1f3eb'},
    {id: 'telegram', icon: 'media/page/telegram.svg', name: 'Telegram', color: '#70ccf5', packaging: 'Flatpak', unread: 12},
    {id: 'cloud', icon: 'media/page/nextcloud.svg', name: 'Nextcloud', color: '#73bcff', packaging: 'AppImage', message: _('All files are up to date')},
    {id: 'signal', icon: 'media/page/signal.svg', name: 'Signal', color: '#a3baff', packaging: 'Flatpak'},
    {id: 'vlc', icon: 'media/page/vlc.svg', name: 'VLC', color: '#ffc07b'},
    {id: 'obs', icon: 'media/page/obs.svg', name: 'OBS Studio', color: '#f1f1f1', packaging: 'Flatpak'},
    {id: 'remmina', icon: 'media/page/remmina.svg', name: 'Remmina', color: '#97b9f7', packaging: 'Snap'},
    // A Proton game launcher with an old XEmbed tray icon. It draws its own
    // pixmap on its own black window, as src/shell/xembed/xembedTrayIcon.js
    // embeds it, so no icon setting of ours reaches it.
    {id: 'battlenet', icon: 'media/page/battlenet.svg', name: 'Battle.net', color: '#148EFF', packaging: 'Proton', isXembed: true},
    // A windowless background app with no tray icon of its own. GNOME lists
    // it under Background Apps, enable-background-proxy gives it a proxy icon
    // as src/shell/backgroundAppsProxy/backgroundAppsProxyIcon.js does.
    {
        id: 'org.gnome.World.PikaBackup',
        icon: 'media/page/org.gnome.World.PikaBackup.svg',
        name: 'Pika Backup',
        packaging: 'Flatpak',
        message: _('Monitoring backup schedule'),
        isColored: true,
        isBackgroundProxy: true,
    },
];

// The order the user left the tray in, apps the page no longer has drop out
apps.sort((a, b) => rank(a) - rank(b));

function rank(app) {
    const index = storedOrder.indexOf(app.id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

// Quitting it in Quick Settings lasts until the page reloads
let isBackgroundAppRunning = true;

export function backgroundApp() {
    return isBackgroundAppRunning ? apps.find(app => app.isBackgroundProxy) : null;
}

export function quitBackgroundApp() {
    isBackgroundAppRunning = false;
}

// Quit from a tray menu, for this visit only, as a quit app stays gone until it starts again
const quitApps = new Set();

export function quitApp(app) {
    quitApps.add(app.id);
}

// A proxy stands in for GNOME's hidden list, so it exists only while that list
// is hidden, its own switch is on and the app still runs, as _sync in
// src/shell/backgroundAppsProxy/backgroundAppsProxyWatcher.js decides
export function isAppPresent(app) {
    if (quitApps.has(app.id))
        return false;
    if (app.isXembed)
        return state.wine;
    return !app.isBackgroundProxy || (state.hideBackground && state.backgroundProxy && isBackgroundAppRunning);
}

export function presentApps() {
    return apps.filter(isAppPresent);
}

// The app dialog's custom icon wins over the app's own
export function appIconMarkup(app, attributes = '', style = '') {
    if (app.isXembed)
        return xembedIconMarkup(app, attributes, style);
    const custom = state.appConfigs[app.id]?.icon;
    if (custom)
        return iconValueMarkup(custom, attributes, style);
    // A colour icon brings a mask twin, symbolic mode in _tray.scss swaps to it
    // so the icon goes monochrome like the rest
    if (app.isColored)
        return `${colorIconMarkup(app.icon, attributes, style)}<svg class="bti bti-symbolic-twin" ${attributes} style="${style}--bti:url(${app.icon})"></svg>`;
    return `<svg class="bti" ${attributes} style="${style}--bti:url(${app.icon})"></svg>`;
}

function xembedIconMarkup(app, attributes, style) {
    return `<svg class="bti-xembed" viewBox="0 0 100 100" ${attributes} style="${style}"><rect width="100" height="100" fill="#000" stroke="none"/>` +
        `<image href="${app.icon}" x="12" y="12" width="76" height="76"/></svg>`;
}

// A full colour app icon in an SVG box, so it takes the size every icon spot gives an svg
export function colorIconMarkup(path, attributes = '', style = '') {
    return `<svg class="bti-image" viewBox="0 0 100 100" ${attributes} style="${style}"><image href="${path}" width="100" height="100"/></svg>`;
}

export function displayName(app) {
    return state.appConfigs[app.id]?.name || app.name;
}

export function isAppHidden(app) {
    return Boolean(state.appConfigs[app.id]?.hidden);
}

export function appById(id) {
    return apps.find(app => app.id === id);
}

export function appBadges(app) {
    const badges = app.packaging ? [app.packaging] : [];
    return app.isBackgroundProxy ? [...badges, _('Background App')] : badges;
}
