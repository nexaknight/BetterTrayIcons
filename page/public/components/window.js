import {applyClamp} from './clamp.js';
import {icon} from './icon.js';
import {toolbar} from './toolbar.js';
import {_} from '../shared/i18n.js';
import {clamp} from '../shared/util.js';
import {buttonMarkup} from './button.js';

// Mirror WINDOW_WIDTH_PX, WINDOW_HEIGHT_PX in prefs.js and the 360px floor
// named in src/prefs/components/card.js
const WINDOW_WIDTH_PX = 1000;
const WINDOW_HEIGHT_PX = 700;
const WINDOW_MIN_WIDTH_PX = 360;
const TRANSLATION_GUIDE_URL = 'https://github.com/nexaknight/BetterTrayIcons/wiki/Translation-Guidelines';
const mount = document.querySelector('#prefs-mount');
export const stage = document.querySelector('#prefs-window-stage');
export let root;
export let sidebar;
export let sidebarShade;
export let sidebarBrandEnd;
export let sidebarButtons;
export let main;
export let headerTitle;
export let headerStart;
export let headerEnd;
export let translateBanner;
export let scroll;
export let body;
export let overlay;
export let alertLayer;
export let toastElement;

let fittedWidth = -1;
let resizeFrame = 0;
let onWidthChange;

// The page table and the sidebar both import this module, so prefs.js hands
// them in
export function createWindow(pages, onWidth) {
    onWidthChange = onWidth;
    root = mount.appendChild(document.createElement('div'));
    root.className = 'prefs-native';
    root.setAttribute('aria-label', 'Better Tray Icons preferences recreation');
    root.innerHTML = windowMarkup(pages);
    sidebar = root.querySelector('.pref-sidebar');
    sidebarShade = root.querySelector('.pref-sidebar-shade');
    sidebarBrandEnd = root.querySelector('.pref-sidebar-brand-end');
    sidebarButtons = [...root.querySelectorAll('[data-native-page]')];
    main = root.querySelector('.pref-main');
    headerTitle = root.querySelector('.pref-header-title');
    headerStart = root.querySelector('.pref-header-start');
    headerEnd = root.querySelector('.pref-header-end');
    translateBanner = root.querySelector('.pref-about-banner');
    scroll = root.querySelector('.pref-scroll');
    body = root.querySelector('.pref-body');
    overlay = root.querySelector('.pref-overlay');
    alertLayer = root.querySelector('.pref-alert-layer');
    toastElement = root.querySelector('.pref-native-toast');
    followClamps();
}

// The page and an open dialog each clamp their rows like Adw.PreferencesPage
// whenever the window or the sidebar changes their width
function followClamps() {
    const observer = new ResizeObserver(() => {
        applyClamp(scroll);
        const dialogBody = overlay.querySelector('.pref-dialog-body');
        if (dialogBody)
            applyClamp(dialogBody);
    });
    observer.observe(scroll);
    observer.observe(overlay);
}

function windowMarkup(pages) {
    const nav = Object.entries(pages).map(([id, {title, iconName}]) =>
        buttonMarkup({leading: icon(iconName), title: `<span>${title}</span>`, attributes: `data-native-page="${id}"`})
    ).join('');
    return `<aside class="pref-sidebar"><div class="pref-sidebar-brand"><img src="assets/icon.png" alt=""><span><strong>Better Tray Icons</strong><small>${_('Settings')}</small></span>` +
        '<span class="pref-sidebar-brand-end"></span></div>' +
        `<nav class="pref-sidebar-nav" aria-label="${_('Extension preference pages')}">${nav}</nav></aside>` +
        '<div class="pref-sidebar-shade" hidden></div>' +
        `<section class="pref-main">${toolbar(_('Appearance'), '', '', 'pref-header')}` +
        `<div class="pref-about-banner" hidden><span>${_('Help translate this extension.')}</span>` +
        `<a href="${TRANSLATION_GUIDE_URL}" target="_blank" rel="noopener" aria-description="${_('Opens in a new tab')}">${_('Translate')}</a></div>` +
        '<div class="pref-scroll"><div class="pref-body"></div></div></section>' +
        '<div class="pref-overlay" hidden></div><div class="pref-alert-layer" hidden></div><div class="pref-native-toast" role="status" hidden></div>';
}

// Closing hides the window on the hero desktop until something opens a
// page again, a reload always shows it
export function showWindow() {
    stage.parentElement.hidden = false;
    fitWindow();
}

export function closeWindow() {
    stage.parentElement.hidden = true;
}

export function scheduleFit() {
    if (resizeFrame)
        return;
    resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        fitWindow();
    });
}

// The window reflows down to its minimum width like the real one, only a
// stage narrower than that scales the whole window down
export function fitWindow() {
    const width = stage.clientWidth;
    if (width <= 0)
        return;
    const windowWidth = clamp(width, WINDOW_MIN_WIDTH_PX, WINDOW_WIDTH_PX);
    const scale = Math.min(1, width / WINDOW_MIN_WIDTH_PX);
    if (width !== fittedWidth) {
        fittedWidth = width;
        mount.style.width = `${windowWidth}px`;
        mount.style.transform = scale < 1 ? `scale(${scale})` : '';
        root.style.width = `${windowWidth}px`;
        onWidthChange(windowWidth);
    }
    const height = `${WINDOW_HEIGHT_PX * scale}px`;
    if (stage.style.height !== height)
        stage.style.height = height;
}

// Position inside a scaled scope, in the scope's own unscaled pixels
export function rectInScope(element, scope) {
    const rect = element.getBoundingClientRect();
    if (!scope)
        return rect;
    const bounds = scope.getBoundingClientRect();
    const scale = bounds.width / scope.offsetWidth;
    return {
        left: (rect.left - bounds.left) / scale,
        top: (rect.top - bounds.top) / scale,
        bottom: (rect.bottom - bounds.top) / scale,
        width: rect.width / scale,
    };
}
