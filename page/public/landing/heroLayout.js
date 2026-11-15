import {desktop, reducedMotion} from './elements.js';
import {slideBy} from './trayLayout.js';
import {state as prefs} from '../shared/store.js';

const heroParts = [...desktop.querySelectorAll('.hero-demo, .desktop-center')];
let panelPosition = 'right';

// The preferences window sits away from the tray so both stay in view. A
// tray in the center or inside Quick Settings counts as the right side.
export function placeDemoWindow(position = panelPosition) {
    panelPosition = position;
    const isTrayOnLeft = position === 'left' && prefs.displayMode !== 'background-apps';
    const side = isTrayOnLeft ? 'right' : 'left';
    if (desktop.dataset.demoSide === side)
        return;
    const before = heroParts.map(part => part.getBoundingClientRect());
    desktop.dataset.demoSide = side;
    if (reducedMotion.matches)
        return;
    heroParts.forEach((part, index) => {
        const now = part.getBoundingClientRect();
        slideBy(part, before[index].left - now.left, before[index].top - now.top);
    });
}
