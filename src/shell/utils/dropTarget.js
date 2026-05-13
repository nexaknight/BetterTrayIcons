function _safeBounds(actor) {
    try {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        return [x, y, w, h];
    } catch {
        return null;
    }
}

// DND passes the DraggableTrayIcon wrapper directly via actor._delegate.
// The fallback paths cover older GNOME versions that surfaced the raw
// actor or proxy instead.
export function getDraggableFromSource(source) {
    if (!source)
        return null;
    if (typeof source.appId === 'string')
        return source;
    if (source._draggableItem)
        return source._draggableItem;
    if (source.actor?._draggableItem)
        return source.actor._draggableItem;
    return null;
}

export function isPointInActor(x, y, actor) {
    if (!actor)
        return false;
    try {
        const [ax, ay] = actor.get_transformed_position();
        const [aw, ah] = actor.get_transformed_size();
        return x >= ax && x <= ax + aw && y >= ay && y <= ay + ah;
    } catch {
        // Actor disposed mid-hit-test.
        return false;
    }
}

export function nearestRowIndex(items, x) {
    for (let i = 0; i < items.length; i++) {
        const b = _safeBounds(items[i].actor);
        if (!b)
            continue;
        const [cx, , cw] = b;
        if (x < cx + cw / 2)
            return i;
    }
    return items.length;
}

// Pointer-over-icon wins. Otherwise pick the nearest by distance.
export function nearestGridIndex(items, x, y) {
    for (let i = 0; i < items.length; i++) {
        const b = _safeBounds(items[i].actor);
        if (!b)
            continue;
        const [cx, cy, cw, ch] = b;
        if (x >= cx && x <= cx + cw && y >= cy && y <= cy + ch)
            return x > cx + cw / 2 ? i + 1 : i;
    }

    let nearest = -1;
    let bestDist = Infinity;
    let nearestX = 0, nearestW = 0;
    for (let i = 0; i < items.length; i++) {
        const b = _safeBounds(items[i].actor);
        if (!b)
            continue;
        const [cx, cy, cw, ch] = b;
        const dx = x - (cx + cw / 2);
        const dy = y - (cy + ch / 2);
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            nearest = i;
            nearestX = cx;
            nearestW = cw;
        }
    }

    if (nearest === -1)
        return items.length;
    return x > nearestX + nearestW / 2 ? nearest + 1 : nearest;
}

export function dragStageCoords(dragActor) {
    try {
        const [x, y] = dragActor.get_transformed_position();
        const [w, h] = dragActor.get_transformed_size();
        return [x + w / 2, y + h / 2];
    } catch {
        // Drag actor disposed mid-call, so fall back to the pointer.
        return global.get_pointer();
    }
}
