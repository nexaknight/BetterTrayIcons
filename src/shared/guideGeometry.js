// The prefs guides draw with Cairo and the page's with SVG, both place their
// lines and labels from here.
export const GUIDE_TICK_PX = 3;
export const GUIDE_LABEL_PADDING_PX = 3;
export const GUIDE_LABEL_RADIUS_PX = 4;
const GUIDE_LABEL_GAP_PX = 3;

// A side measures along its own axis, centered on the other one.
export function sideSegment(box, side, length, {isOutward}) {
    const isVertical = side === 'top' || side === 'bottom';
    const edge = {top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width}[side];
    const inwardSign = side === 'top' || side === 'left' ? 1 : -1;
    const end = edge + (isOutward ? -inwardSign : inwardSign) * length;
    const center = isVertical ? box.x + box.width / 2 : box.y + box.height / 2;
    return {
        side,
        isOutward,
        isVertical,
        length,
        x1: isVertical ? center : edge,
        y1: isVertical ? edge : center,
        x2: isVertical ? center : end,
        y2: isVertical ? end : center,
    };
}

// A margin label sits past the line's outer end, a padding label in its side's
// own corner, so eight labels around a small icon stay apart.
export function labelOrigin({side, isOutward, x1, y1, x2, y2}, width, height) {
    const gap = GUIDE_LABEL_GAP_PX;
    if (isOutward) {
        return {
            top: [x2 - width / 2, y2 - gap - height],
            bottom: [x2 - width / 2, y2 + gap],
            left: [x2 - gap - width, y2 - height / 2],
            right: [x2 + gap, y2 - height / 2],
        }[side];
    }
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const offset = GUIDE_TICK_PX + gap;
    return {
        top: [midX + offset, midY - height / 2],
        bottom: [midX - offset - width, midY - height / 2],
        left: [midX - width / 2, midY - offset - height],
        right: [midX - width / 2, midY + offset],
    }[side];
}

export function containsPoint(box, x, y) {
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

export function outset(box, sides) {
    return {
        x: box.x - sides.left,
        y: box.y - sides.top,
        width: box.width + sides.left + sides.right,
        height: box.height + sides.top + sides.bottom,
    };
}
