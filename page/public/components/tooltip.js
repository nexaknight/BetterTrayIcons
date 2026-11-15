import {rectInScope, root} from './window.js';
import {state, ui} from '../shared/store.js';
import {clamp} from '../shared/util.js';

export const POPUP_GAP_PX = 6;
const TOOLTIP_DELAY_MS = 500;
const TOOLTIP_EDGE_PX = 5;
let tooltip;

let tooltipTimer = 0;
let tooltipTarget = null;

export function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'pref-tooltip';
    tooltip.id = 'pref-widget-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    root.append(tooltip);
}

export function tooltipOwner(target) {
    const element = target.closest('[data-pref-tooltip],[title]');
    if (element?.hasAttribute('title')) {
        element.dataset.prefTooltip = element.getAttribute('title');
        element.removeAttribute('title');
    }
    return element;
}

// A tray icon's tooltip follows show-tooltips, tooltip-delay and
// tooltip-position of the demo, as src/shell/features/tooltip.js does
export function queuePrefTooltip(target) {
    if (target === tooltipTarget)
        return;
    hidePrefTooltip();
    const isTrayIcon = target.matches('.tray-icon');
    if (isTrayIcon && !state.tooltips)
        return;
    tooltipTarget = target;
    tooltipTimer = setTimeout(() => showPrefTooltip(target), isTrayIcon ? state.tooltipDelay : TOOLTIP_DELAY_MS);
}

function showPrefTooltip(target) {
    if (!target.isConnected || ui.dropdownPopover)
        return;
    const scope = target.closest('.prefs-native');
    (scope || document.body).append(tooltip);
    tooltip.classList.toggle('bti-global-tooltip', !scope);
    tooltip.textContent = target.dataset.prefTooltip;
    tooltip.hidden = false;
    target.setAttribute('aria-describedby', tooltip.id);

    const rect = rectInScope(target, scope);
    const maxWidth = scope ? scope.offsetWidth : globalThis.innerWidth;
    const maxHeight = scope ? scope.offsetHeight : globalThis.innerHeight;
    const centered = rect.left + rect.width / 2 - tooltip.offsetWidth / 2;
    const below = rect.bottom + POPUP_GAP_PX;
    const above = rect.top - tooltip.offsetHeight - POPUP_GAP_PX;
    const fitsBelow = below + tooltip.offsetHeight < maxHeight - TOOLTIP_EDGE_PX;
    const fitsAbove = above > TOOLTIP_EDGE_PX;
    const wantsAbove = target.matches('.tray-icon') ? state.tooltipPosition === 'top' : !fitsBelow;
    // The wanted side wins while it has room, the other side catches the rest
    const isAbove = wantsAbove ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    tooltip.style.left = `${clamp(centered, TOOLTIP_EDGE_PX, maxWidth - TOOLTIP_EDGE_PX - tooltip.offsetWidth)}px`;
    tooltip.style.top = `${isAbove ? above : below}px`;
}

export function hidePrefTooltip() {
    clearTimeout(tooltipTimer);
    tooltipTarget?.removeAttribute('aria-describedby');
    tooltipTarget = null;
    tooltip.hidden = true;
}

export function onTooltipPointerOut(event) {
    const target = event.target.closest('[data-pref-tooltip]');
    const isLeaving = target && target === tooltipTarget && !target.contains(event.relatedTarget);
    if (isLeaving && document.activeElement !== target)
        hidePrefTooltip();
}
