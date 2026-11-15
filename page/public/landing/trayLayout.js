import {reducedMotion} from './elements.js';

const SLIDE_MS = 200;
const STAGGER_MS = 10;
const SLIDE_EASING = 'cubic-bezier(0,0,.2,1)';

// A tray is the order, its nodes, the panel box and the box for the rest.
// The hero tray and the miniature one share this, drag.js moves both.
// shown() leaves out the apps the app dialog hides.
export function layoutTray(tray, shouldAnimate) {
    const before = shouldAnimate ? measureNodes(tray) : null;
    const hiddenList = tray.hiddenList();
    const shown = tray.shown();
    const visibleCount = tray.visibleCount();
    for (const app of tray.order) {
        const node = tray.nodes.get(app.id);
        node.getAnimations().forEach(animation => animation.cancel());
        const index = shown.indexOf(app);
        if (index < 0) {
            node.remove();
            continue;
        }
        const box = index < visibleCount ? tray.inline : hiddenList;
        box.append(node);
    }
    if (shouldAnimate && !reducedMotion.matches)
        slideFrom(tray, before);
}

function measureNodes(tray) {
    const rects = new Map();
    for (const [id, node] of tray.nodes)
        rects.set(id, node.getBoundingClientRect());
    return rects;
}

function slideFrom(tray, before) {
    tray.shown().forEach((app, index) => {
        const node = tray.nodes.get(app.id);
        const old = before.get(app.id);
        const now = node.getBoundingClientRect();
        // A node that was not laid out before, inside a closed popup, has no
        // start to slide from and fades in on its slot instead
        if (!now.width)
            return;
        if (!old.width) {
            node.animate([{opacity: 0}, {opacity: 1}], {duration: SLIDE_MS, easing: SLIDE_EASING});
            return;
        }
        // The miniature is scaled, a translate moves in its unscaled pixels
        const scale = now.width / node.offsetWidth;
        slideBy(node, (old.left - now.left) / scale, (old.top - now.top) / scale, index * STAGGER_MS);
    });
}

export function slideBy(node, dx, dy, delay = 0) {
    if (!dx && !dy)
        return;
    node.animate([
        {transform: `translate(${dx}px,${dy}px)`},
        {transform: 'translate(0,0)'},
    ], {duration: SLIDE_MS, delay, easing: SLIDE_EASING});
}

// Hidden apps keep their slots, only the shown ones trade places
export function setShownOrder(tray, shownOrder) {
    const next = shownOrder[Symbol.iterator]();
    const order = tray.order.map(app => shownOrder.includes(app) ? next.next().value : app);
    tray.order.splice(0, order.length, ...order);
}
