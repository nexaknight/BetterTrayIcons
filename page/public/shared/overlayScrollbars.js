// Marks a box while it scrolls, the overlay-scrollbar mixin in
// styles/_mixins.scss shows the bar for the mark and fades it afterwards
const SCROLL_IDLE_MS = 150;
const idleTimers = new WeakMap();

export function bindOverlayScrollbars() {
    document.addEventListener('scroll', onAnyScroll, {capture: true, passive: true});
}

function onAnyScroll(event) {
    const box = event.target;
    // The page itself keeps the browser's own scrollbar
    if (!(box instanceof Element))
        return;
    box.classList.add('is-scrolling');
    clearTimeout(idleTimers.get(box));
    idleTimers.set(box, setTimeout(() => box.classList.remove('is-scrolling'), SCROLL_IDLE_MS));
}
