import {startClock} from './clock.js';
import {bindDrag} from './drag.js';
import {reducedMotion} from './elements.js';
import {createTrayButton} from './tray.js';
import {layoutTray} from './trayLayout.js';
import {STOCK_TOGGLE_ICON, toggleIconMarkup} from '../shared/toggleIcon.js';
import {apps} from '../shared/apps.js';
import {clamp} from '../shared/util.js';

const MINI_VISIBLE = 2;
const MINI_BASE_WIDTH_PX = 491;
const MINI_BASE_HEIGHT_PX = 186;
const MINI_POPUP_EDGE_PX = 12;
// cursor-default.png is the 48px image of Adwaita's default cursor drawn
// at 32px, its hotspot (6, 2) lands at (4, 1.33) there
const CURSOR_HOT_X_PX = 4;
const CURSOR_HOT_Y_PX = 1.33;
const CURSOR_START_X_PX = -150;
const CURSOR_START_Y_PX = -80;
const CURSOR_MOVE_MS = 900;
const CURSOR_SHOWN_RATIO = 0.6;
const miniNative = document.querySelector('#mini-native');
const miniViewport = miniNative.parentElement;
const miniPanel = miniNative.querySelector('.mini-panel');
const miniToggle = miniPanel.querySelector('.tray-toggle');
const miniPopup = document.querySelector('#mini-popup');
const miniPopupIcons = document.querySelector('#mini-popup-icons');
const miniCursor = miniNative.querySelector('.mini-cursor');

const miniTray = {
    // The Proton launcher is a hero-only exhibit
    order: apps.filter(app => !app.isBackgroundProxy && !app.isXembed),
    shown: () => miniTray.order.slice(),
    nodes: new Map(),
    inline: document.querySelector('#mini-visible'),
    visibleCount: () => MINI_VISIBLE,
    hiddenList: () => miniPopupIcons,
    hiddenZone: () => miniPopup.hidden ? null : miniPopup,
    render: shouldAnimate => {
        layoutTray(miniTray, shouldAnimate);
        positionMiniOverlays();
    },
    open: () => setMiniPopupOpen(true),
};

let miniWidth = -1;
let miniFrame = 0;

export function setUpMiniTray() {
    miniToggle.innerHTML = toggleIconMarkup(STOCK_TOGGLE_ICON, 'tray-toggle-icon');
    for (const app of miniTray.order) {
        const button = createTrayButton(app, miniTray);
        bindDrag(button, app, miniTray);
        miniTray.nodes.set(app.id, button);
    }
    miniTray.render(false);

    miniToggle.addEventListener('click', () => {
        setMiniPopupOpen(miniPopup.hidden);
        miniCursor.hidden = false;
    });
    miniNative.querySelector('.mini-show-desktop').addEventListener('click', () => {
        setMiniPopupOpen(false);
        miniCursor.hidden = true;
    });

    startClock(miniNative.querySelector('.mini-clock'), positionMiniOverlays);
    new ResizeObserver(scheduleMiniFit).observe(miniViewport);
    document.fonts.ready.then(() => {
        miniWidth = -1;
        scheduleMiniFit();
        if (reducedMotion.matches)
            openMiniPopupUnderCursor();
        else
            playOnFirstSight();
    });
}

// Next frame, a height change inside the observer callback raises the ResizeObserver loop error
function scheduleMiniFit() {
    if (miniFrame)
        return;
    miniFrame = requestAnimationFrame(() => {
        miniFrame = 0;
        fitMiniTray();
    });
}

function fitMiniTray() {
    const width = miniViewport.clientWidth;
    if (width === miniWidth)
        return;
    miniWidth = width;
    const scale = width / MINI_BASE_WIDTH_PX;
    miniNative.style.transform = `scale(${scale})`;
    // _miniTray.scss keeps the show-desktop line at one screen pixel with it
    miniNative.style.setProperty('--mini-scale', scale);
    miniViewport.style.height = `${MINI_BASE_HEIGHT_PX * scale}px`;
    positionMiniOverlays();
}

function setMiniPopupOpen(shouldOpen) {
    miniPopup.hidden = !shouldOpen;
    miniToggle.setAttribute('aria-expanded', shouldOpen);
    positionMiniOverlays();
}

function positionMiniOverlays() {
    placeMiniCursor();
    if (miniPopup.hidden)
        return;
    const buttonLeft = miniPanel.offsetLeft + miniToggle.offsetLeft;
    const centered = buttonLeft + miniToggle.offsetWidth / 2 - miniPopup.offsetWidth / 2;
    miniPopup.style.left = `${clamp(centered, 0, miniNative.offsetWidth - miniPopup.offsetWidth - MINI_POPUP_EDGE_PX)}px`;
}

function placeMiniCursor() {
    const {left, top} = centerInMiniature(miniToggle);
    miniCursor.style.left = `${left - CURSOR_HOT_X_PX}px`;
    miniCursor.style.top = `${top - CURSOR_HOT_Y_PX}px`;
}

// In the miniature's own unscaled pixels, the panel nests too deep for offsets
function centerInMiniature(element) {
    const bounds = miniNative.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const scale = bounds.width / miniNative.offsetWidth;
    return {
        left: (rect.left + rect.width / 2 - bounds.left) / scale,
        top: (rect.top + rect.height / 2 - bounds.top) / scale,
    };
}

function openMiniPopupUnderCursor() {
    miniCursor.hidden = false;
    setMiniPopupOpen(true);
}

// Once per load, so scrolling back up and down does not replay it
function playOnFirstSight() {
    const observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting)
            return;
        observer.disconnect();
        playCursorToToggle();
    }, {threshold: CURSOR_SHOWN_RATIO});
    observer.observe(miniViewport);
}

function playCursorToToggle() {
    miniCursor.hidden = false;
    const move = miniCursor.animate([{transform: `translate(${CURSOR_START_X_PX}px, ${CURSOR_START_Y_PX}px)`}, {transform: 'none'}], {
        duration: CURSOR_MOVE_MS,
        easing: 'ease-in-out',
    });
    move.onfinish = () => setMiniPopupOpen(true);
}
