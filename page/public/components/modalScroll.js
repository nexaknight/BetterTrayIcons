// While a dialog dims the page, the page behind holds still and the wheel or
// a touch drag anywhere outside the dialog scrolls the dialog's body. Inside
// the dialog every scroll area keeps scrolling itself.
const LINE_HEIGHT_PX = 16;
// Popovers and pickers float above the dialog without being inside it
const FLOATING = '.pref-dropdown-popover, .pref-color-overlay, .pref-alert-layer, .shell-menu';
const modals = [];
let touchY = null;

export function holdPage(owner, dialog) {
    if (modals.some(modal => modal.owner === owner))
        return;
    if (!modals.length)
        lockPage();
    modals.push({owner, dialog});
}

export function releasePage(owner) {
    const index = modals.findIndex(modal => modal.owner === owner);
    if (index < 0)
        return;
    modals.splice(index, 1);
    if (!modals.length)
        unlockPage();
}

// The scrollbar's width goes into padding, so the page does not jump sideways
function lockPage() {
    const gap = globalThis.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = gap > 0 ? `${gap}px` : '';
}

function unlockPage() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
}

function outsideScroller(target) {
    const dialog = modals.at(-1)?.dialog();
    if (!dialog || dialog.contains(target) || target.closest?.(FLOATING))
        return null;
    return dialog.querySelector('.pref-dialog-body');
}

document.addEventListener('wheel', event => {
    const scroller = outsideScroller(event.target);
    if (!scroller)
        return;
    event.preventDefault();
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT_PX : 1;
    scroller.scrollBy(0, event.deltaY * scale);
}, {passive: false, capture: true});

document.addEventListener('touchstart', event => {
    touchY = outsideScroller(event.target) ? event.touches[0].clientY : null;
}, {passive: true, capture: true});

document.addEventListener('touchmove', event => {
    const scroller = touchY === null ? null : outsideScroller(event.target);
    if (!scroller)
        return;
    event.preventDefault();
    const y = event.touches[0].clientY;
    scroller.scrollBy(0, touchY - y);
    touchY = y;
}, {passive: false, capture: true});
