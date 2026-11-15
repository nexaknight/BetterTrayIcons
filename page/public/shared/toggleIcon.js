import {iconValueMarkup} from './iconValues.js';
import {state, toggleKey} from './store.js';

// The theme's view-more-symbolic has no file in the repo, the page draws its
// three dots in CSS instead, see styles/landing/_tray.scss
export const STOCK_TOGGLE_ICON = 'view-more-symbolic';

export function toggleIconMarkup(value, className = '') {
    if (value === STOCK_TOGGLE_ICON)
        return `<span class="toggle-dots ${className}" aria-hidden="true">•••</span>`;
    return iconValueMarkup(value, 'aria-hidden="true"', '', className);
}

// _applyIconState in src/shell/components/toggleButton.js. Without rotation
// the open icon replaces the closed one, with it the closed icon turns.
export function toggleIconState(isOpen) {
    const isRotating = state[toggleKey('rotate')];
    const degrees = Number.parseInt(state[toggleKey('rotateAngle')], 10);
    const direction = state[toggleKey('rotateReverse')] ? -1 : 1;
    const angle = isOpen && isRotating ? degrees * direction : 0;
    return {
        value: state[toggleKey(isOpen && !isRotating ? 'toggleIconOpen' : 'toggleIcon')],
        angle,
        isAnimated: state[toggleKey('animateRotation')],
        duration: state[toggleKey('rotateDuration')],
        delay: state[toggleKey('rotateDelay')],
    };
}
