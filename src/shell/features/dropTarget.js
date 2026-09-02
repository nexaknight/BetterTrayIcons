import {safeBounds, settledBounds} from '../actorPlacement.js';

// GNOME's dnd.js hands drop targets actor._delegate as source, which
// dragAndDrop.js points at the DraggableTrayIcon wrapper.
export function getDraggableFromSource(source) {
    if (!source)
        return null;
    if (typeof source.appId === 'string')
        return source;
    return null;
}

export function isPointInActor(x, y, actor) {
    const bounds = safeBounds(actor);
    if (!bounds)
        return false;
    const [left, top, width, height] = bounds;
    const isInsideX = x >= left && x <= left + width;
    const isInsideY = y >= top && y <= top + height;
    return isInsideX && isInsideY;
}

export function slotIndexAt(actors, x, y, dragged = null) {
    const slots = _settledSlots(actors);
    if (!slots.length)
        return 0;
    return _cellIndexAt(_rowFor(slots, y, dragged), x);
}

function _settledSlots(actors) {
    const slots = [];
    actors.forEach((actor, index) => {
        const bounds = settledBounds(actor);
        if (bounds) {
            const [x, y, width, height] = bounds;
            slots.push({index, actor, x, y, height, end: x + width});
        }
    });
    return slots;
}

// The row that contains y wins, a y in the gap keeps the dragged icon's
// row, so a drag never flips rows without really entering the other one.
function _rowFor(slots, y, dragged) {
    const rows = new Map();
    for (const slot of slots) {
        const key = Math.round(slot.y);
        if (!rows.has(key))
            rows.set(key, []);
        rows.get(key).push(slot);
    }

    const bands = [...rows.values()];
    return bands.find(band => y >= band[0].y && y <= band[0].y + band[0].height) ??
        bands.find(band => band.some(slot => slot.actor === dragged)) ??
        bands.reduce((best, band) => _rowDistance(band, y) < _rowDistance(best, y) ? band : best);
}

function _rowDistance(band, y) {
    return Math.abs(y - band[0].y - band[0].height / 2);
}

function _cellIndexAt(row, x) {
    const cells = [...row].sort((a, b) => a.x - b.x);
    for (let i = 0; i < cells.length - 1; i++) {
        const gapMiddle = (cells[i].end + cells[i + 1].x) / 2;
        if (x < gapMiddle)
            return cells[i].index;
    }
    return cells.at(-1).index;
}

export function dragStageCoords(dragActor) {
    const bounds = safeBounds(dragActor);
    if (!bounds)
        return global.get_pointer();
    const [x, y, width, height] = bounds;
    return [x + width / 2, y + height / 2];
}
