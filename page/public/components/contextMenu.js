import {escapeHtml} from '../shared/util.js';
import {buttonMarkup} from './button.js';

const MENU_GAP_PX = 4;
const MENU_EDGE_PX = 8;
export const NAVIGATION_STEPS = {
    ArrowDown: (index, count) => (index + 1) % count,
    ArrowUp: (index, count) => (index - 1 + count) % count,
    Home: () => 0,
    End: (_index, count) => count - 1,
};

let menu = null;

// A shell popup menu with the item kinds src/shell/sni/dbusMenuClient.js
// builds, plain, checkmark, insensitive and separator
export function openContextMenu(anchor, items, {beside = null, look = ''} = {}) {
    const wasOwnMenu = menu?.anchor === anchor;
    closeContextMenu();
    if (wasOwnMenu)
        return;
    const element = document.createElement('div');
    element.className = `shell-menu ${look}`;
    element.setAttribute('role', 'menu');
    element.setAttribute('aria-label', anchor.getAttribute('aria-label'));
    element.innerHTML = items.map(menuItemMarkup).join('');
    const host = anchor.closest('#desktop');
    host.append(element);
    menu = {element, anchor, items};
    anchor.setAttribute('aria-expanded', 'true');
    if (beside)
        placeBeside(element, anchor, beside, host);
    else
        placeMenu(element, anchor, host);
    element.addEventListener('click', onMenuClick);
    element.addEventListener('keydown', onMenuKey);
    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('keydown', onDocumentEscape, true);
    menuItems()[0]?.focus({preventScroll: true});
}

function placeMenu(element, anchor, host) {
    const bounds = host.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const centered = rect.left - bounds.left + rect.width / 2 - element.offsetWidth / 2;
    const maxLeft = bounds.width - element.offsetWidth - MENU_EDGE_PX;
    element.style.left = `${Math.max(MENU_EDGE_PX, Math.min(centered, maxLeft))}px`;
    const panelMenuTop = anchor.closest('.panel') && getComputedStyle(host).getPropertyValue('--panel-menu-top');
    element.style.top = panelMenuTop || `${rect.bottom - bounds.top + MENU_GAP_PX}px`;
}

// Left of the Quick Settings while there is room, as the real side menu opens
function placeBeside(element, anchor, beside, host) {
    const bounds = host.getBoundingClientRect();
    const box = beside.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const leftSide = box.left - bounds.left - MENU_GAP_PX - element.offsetWidth;
    const rightSide = box.right - bounds.left + MENU_GAP_PX;
    element.style.left = `${leftSide >= MENU_EDGE_PX ? leftSide : rightSide}px`;
    const maxTop = bounds.height - element.offsetHeight - MENU_EDGE_PX;
    element.style.top = `${Math.max(MENU_EDGE_PX, Math.min(rect.top - bounds.top, maxTop))}px`;
}

export function contextMenuAnchor() {
    return menu?.anchor ?? null;
}

export function closeContextMenu(shouldRestoreFocus = false) {
    if (!menu)
        return;
    const {element, anchor} = menu;
    menu = null;
    element.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    document.removeEventListener('keydown', onDocumentEscape, true);
    if (shouldRestoreFocus && anchor.isConnected)
        anchor.focus({preventScroll: true});
}

export function menuItemMarkup(item, index) {
    if (item.separator)
        return '<div class="shell-menu-separator" role="separator"></div>';
    const isCheck = item.isChecked !== undefined;
    const role = isCheck ? 'menuitemcheckbox' : 'menuitem';
    const checked = isCheck ? `aria-checked="${item.isChecked}"` : '';
    const ornament = isCheck ? `<span class="shell-menu-ornament" aria-hidden="true">${item.isChecked ? '✓' : ''}</span>` : '';
    return buttonMarkup({variant: 'shell-menu-item', leading: ornament, title: `<span>${escapeHtml(item.label)}</span>`, attributes: `role="${role}" ${checked} data-menu-index="${index}" ${item.isDisabled ? 'disabled' : ''}`});
}

function menuItems() {
    return [...menu.element.querySelectorAll('.shell-menu-item:not(:disabled)')];
}

function onMenuClick(event) {
    const button = event.target.closest('[data-menu-index]');
    if (!button || button.disabled)
        return;
    const item = menu.items[button.dataset.menuIndex];
    closeContextMenu(true);
    item.onActivate();
}

function onMenuKey(event) {
    const items = menuItems();
    const step = NAVIGATION_STEPS[event.key];
    if (step) {
        event.preventDefault();
        items[step(items.indexOf(document.activeElement), items.length)].focus({preventScroll: true});
        return;
    }
    if (event.key === 'Tab')
        closeContextMenu();
}

function onDocumentEscape(event) {
    if (event.key !== 'Escape')
        return;
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu(true);
}

function onOutsidePointer(event) {
    const isInside = menu.element.contains(event.target) || menu.anchor.contains(event.target);
    if (!isInside)
        closeContextMenu();
}
