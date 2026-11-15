import {drawer, drawerIcons, reducedMotion} from './elements.js';

// OPEN_MS and CLOSE_MS in src/shell/components/drawer.js
const OPEN_MS = 150;
const CLOSE_MS = 120;
// Covers a close animation that never reports its end
const SETTLE_SLACK_MS = 50;

let isOpen = false;
let closing = Promise.resolve();

export function isDrawerOpen() {
    return isOpen;
}

// The strip clips a box of fixed width and keeps it on its outer edge, so
// the icons slide out from behind the visible ones
export function setDrawerOpen(shouldOpen) {
    if (shouldOpen === isOpen)
        return;
    isOpen = shouldOpen;
    drawer.getAnimations().forEach(animation => animation.cancel());
    if (shouldOpen)
        slideOpen();
    else
        slideClosed();
}

function slideOpen() {
    drawer.hidden = false;
    const width = `${drawerIcons.offsetWidth}px`;
    if (reducedMotion.matches)
        return;
    drawer.animate([{width: '0px'}, {width}], {duration: OPEN_MS, easing: 'ease-out'});
}

function slideClosed() {
    if (reducedMotion.matches) {
        drawer.hidden = true;
        return;
    }
    const width = `${drawer.offsetWidth}px`;
    const slide = drawer.animate([{width}, {width: '0px'}], {duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards'});
    slide.onfinish = () => {
        drawer.hidden = !isOpen;
    };
    const timeout = new Promise(resolve => setTimeout(resolve, CLOSE_MS + SETTLE_SLACK_MS));
    // A cancelled slide rejects, it still counts as settled
    closing = Promise.race([slide.finished.catch(() => {}), timeout]);
}

// Resolves once the strip no longer takes panel width
export function drawerSettled() {
    return closing;
}
