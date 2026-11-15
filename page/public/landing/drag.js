import {setShownOrder} from './trayLayout.js';
import {state as prefs} from '../shared/store.js';

export const REORDER_ACTION = 'Reorder (drag & drop)';

// Mirrors the drag constants in src/shell/features/dragAndDrop.js and
// src/shell/components/panelIndicator.js
const DRAG_ACTOR_OPACITY = 180 / 255;
const SOURCE_OPACITY = 60 / 255;
const DWELL_MS = 100;
const RETARGET_PX = 16;
const DRAG_THRESHOLD_PX = 6;
const GHOST_OFFSET_X_PX = 16;
const GHOST_OFFSET_Y_PX = 15;
const POPUP_HIT_PAD_PX = 4;
const PANEL_HIT_PAD_PX = 8;
const ROW_TOLERANCE_PX = 4;

export let drag = null;
let pending = null;
let dwellTimer = null;

// For trays without click actions, the miniature has nothing to activate
export function bindDrag(button, app, tray) {
    button.addEventListener('pointerdown', event => beginDrag(event, app, button, tray));
}

export function beginDrag(event, app, node, tray) {
    if (event.button !== 0 || !isDragAllowed(event))
        return;
    event.preventDefault();
    drag = {
        tray,
        id: app.id,
        node,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        active: false,
        original: tray.order.slice(),
        ghost: null,
    };
    node.setPointerCapture(event.pointerId);
}

// isDragEnabledFromSettings in src/shell/features/dragAndDrop.js, split by
// input. A mouse follows the Long Press row, a finger the touch dialog's
// long touch, and neither reads the other.
function isDragAllowed(event) {
    const key = event.pointerType === 'touch' ? 'trayTouchLong' : 'trayLeftLong';
    return prefs[key] === REORDER_ACTION;
}

export function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId)
        return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const hasTravelled = Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= DRAG_THRESHOLD_PX;
    if (!drag.active && hasTravelled)
        activateDrag();
    if (!drag.active)
        return;
    event.preventDefault();
    moveGhost();
    previewAt(drag.x, drag.y);
}

// A long press with the reorder action starts the drag without any travel
export function activateDrag() {
    if (!drag || drag.active)
        return;
    drag.active = true;
    drag.tray.open();
    drag.node.classList.add('dragging-source');
    drag.node.style.opacity = SOURCE_OPACITY;

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.color = getComputedStyle(drag.node).color;
    ghost.append(drag.node.querySelector('svg').cloneNode(true));
    ghost.style.opacity = DRAG_ACTOR_OPACITY;
    drag.ghost = ghost;
    document.body.append(ghost);
    document.body.classList.add('tray-dragging');
    moveGhost();
}

function moveGhost() {
    drag.ghost.style.left = `${drag.x - GHOST_OFFSET_X_PX}px`;
    drag.ghost.style.top = `${drag.y - GHOST_OFFSET_Y_PX}px`;
}

export function finishDrag(event, shouldCancel = false) {
    if (!drag)
        return;
    if (event && event.pointerId !== drag.pointerId)
        return;
    if (!drag.active) {
        drag = null;
        return;
    }

    const isCancelled = shouldCancel || !previewAt(event.clientX, event.clientY, true);
    const {tray} = drag;
    if (isCancelled)
        tray.order.splice(0, tray.order.length, ...drag.original);
    clearPending();
    drag.node.classList.remove('dragging-source');
    drag.node.style.removeProperty('opacity');
    drag.ghost.remove();
    document.body.classList.remove('tray-dragging');
    drag = null;
    tray.render(isCancelled);
}

function previewAt(x, y, shouldFlush = false) {
    const target = targetAt(x, y);
    if (target === null) {
        clearPending();
        return false;
    }
    const current = drag.tray.shown().findIndex(app => app.id === drag.id);
    if (target === current) {
        clearPending();
        return true;
    }

    const order = drag.tray.shown();
    order.splice(target, 0, order.splice(current, 1)[0]);
    const key = order.map(app => app.id).join(',');
    if (pending && !shouldFlush) {
        const isSameOrder = pending.key === key;
        const travel = Math.hypot(x - pending.x, y - pending.y);
        if (isSameOrder || travel < RETARGET_PX)
            return true;
    }

    clearPending();
    pending = {order, key, x, y};
    if (shouldFlush)
        commitPreview();
    else
        dwellTimer = setTimeout(commitPreview, DWELL_MS);
    return true;
}

function commitPreview() {
    const {order} = pending;
    clearPending();
    setShownOrder(drag.tray, order);
    drag.tray.render(true);
}

function clearPending() {
    clearTimeout(dwellTimer);
    dwellTimer = null;
    pending = null;
}

function targetAt(x, y) {
    const zone = dropZoneAt(x, y);
    if (!zone)
        return null;
    if (!zone.items.length)
        return zone.offset;

    const band = bandAt(y, slotRows(zone.items, zone.offset));
    for (let i = 0; i < band.length - 1; i++) {
        const boundary = (band[i].x + band[i].width + band[i + 1].x) / 2;
        if (x < boundary)
            return band[i].index;
    }
    return band.at(-1).index;
}

function dropZoneAt(x, y) {
    const {inline} = drag.tray;
    const order = drag.tray.shown();
    const visible = drag.tray.visibleCount();
    const hiddenZone = drag.tray.hiddenZone();
    const isOverHidden = hiddenZone && inBounds(x, y, hiddenZone.getBoundingClientRect(), POPUP_HIT_PAD_PX);
    if (isOverHidden)
        return {items: order.slice(visible), offset: visible};
    if (inBounds(x, y, inline.getBoundingClientRect(), PANEL_HIT_PAD_PX))
        return {items: order.slice(0, visible), offset: 0};
    return null;
}

function inBounds(x, y, rect, pad) {
    return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

function slotRows(items, offset) {
    const rows = [];
    items.forEach((app, i) => {
        const rect = settledRect(drag.tray.nodes.get(app.id));
        const slot = {index: offset + i, x: rect.left, y: rect.top, width: rect.width, height: rect.height};
        let row = rows.find(candidate => Math.abs(candidate[0].y - slot.y) < ROW_TOLERANCE_PX);
        if (!row) {
            row = [];
            rows.push(row);
        }
        row.push(slot);
    });
    return rows;
}

// Layout position without the running slide transform, in screen pixels
// even inside the scaled miniature
function settledRect(node) {
    const parent = node.offsetParent;
    const bounds = parent.getBoundingClientRect();
    const scale = bounds.width / parent.offsetWidth;
    return {
        left: bounds.left + (parent.clientLeft + node.offsetLeft) * scale,
        top: bounds.top + (parent.clientTop + node.offsetTop) * scale,
        width: node.offsetWidth * scale,
        height: node.offsetHeight * scale,
    };
}

function bandAt(y, rows) {
    const sourceIndex = drag.tray.shown().findIndex(app => app.id === drag.id);
    const distance = row => Math.abs(y - row[0].y - row[0].height / 2);
    return rows.find(row => y >= row[0].y && y <= row[0].y + row[0].height) ||
        // Keep the current row while the pointer crosses the spacing between rows
        rows.find(row => row.some(slot => slot.index === sourceIndex)) ||
        rows.reduce((best, row) => distance(row) < distance(best) ? row : best);
}
