import {BOX_SIDES} from '../../../src/shared/boxStyle.js';
import {
    GUIDE_LABEL_PADDING_PX, GUIDE_LABEL_RADIUS_PX, GUIDE_TICK_PX, containsPoint, labelOrigin, outset, sideSegment,
} from '../../../src/shared/guideGeometry.js';
import {state} from '../shared/store.js';
import {STYLE_KINDS} from '../shared/styleDefaults.js';

// A port of bindGuideOverlay and spacingGuides in src/prefs/components/guide.js
export const GUIDE_KEYS = Object.freeze({padding: 'previewShowPadding', margin: 'previewShowMargin'});
const GUIDE_MARGIN_COLOR = 'rgb(255 120 0)';
const GUIDE_PADDING_COLOR = 'var(--pref-accent)';
const GUIDE_LABEL_FONT_PX = 10.67;
const GUIDE_DIGIT_PX = 6.5;

let drawnStage = null;

export function onGuidePointer(event) {
    const stage = event.target.closest?.('.pref-preview-stage');
    if (drawnStage && drawnStage !== stage)
        clearGuides();
    const show = {padding: state[GUIDE_KEYS.padding], margin: state[GUIDE_KEYS.margin]};
    const guide = stage && spacingGuides(stage.dataset.previewKind);
    if (!guide || !(show.padding || show.margin))
        return;
    const targets = [...stage.querySelectorAll('[data-guide-target]')];
    const bounds = stage.getBoundingClientRect();
    const scale = bounds.width / stage.offsetWidth;
    const boxes = targets.map(target => boxIn(target, stage, scale));
    const point = {x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale};
    const hovered = boxes.find(box => containsPoint(outset(box, guide.margin), point.x, point.y)) ?? boxes[0];
    if (!hovered)
        return;
    drawnStage = stage;
    stage.querySelector('.pref-guides').innerHTML = measures(hovered, guide, show);
}

// Only what the page can edit gets a guide, stock spacing is fixed
function spacingGuides(kind) {
    const {customKey, colorPrefix, spacingPrefix} = STYLE_KINDS[kind];
    if (!state[customKey])
        return null;
    const sides = type => Object.fromEntries(BOX_SIDES.map(side => [side, state[`${spacingPrefix}-${type}-${side}`]]));
    return {padding: sides('padding'), margin: sides('margin'), border: state[`${colorPrefix}-border-width`]};
}

function boxIn(element, stage, scale) {
    const rect = element.getBoundingClientRect();
    const bounds = stage.getBoundingClientRect();
    return {x: (rect.left - bounds.left) / scale, y: (rect.top - bounds.top) / scale, width: rect.width / scale, height: rect.height / scale};
}

function measures(box, {padding, margin, border}, show) {
    const inner = {x: box.x + border, y: box.y + border, width: box.width - 2 * border, height: box.height - 2 * border};
    let markup = '';
    for (const side of BOX_SIDES) {
        if (show.margin)
            markup += measure(sideSegment(box, side, margin[side], {isOutward: true}), GUIDE_MARGIN_COLOR);
        if (show.padding)
            markup += measure(sideSegment(inner, side, padding[side], {isOutward: false}), GUIDE_PADDING_COLOR);
    }
    return markup;
}

function measure(segment, color) {
    const {isVertical, length, x1, y1, x2, y2} = segment;
    const tick = (x, y) => isVertical
        ? `M${x - GUIDE_TICK_PX} ${y}H${x + GUIDE_TICK_PX}`
        : `M${x} ${y - GUIDE_TICK_PX}V${y + GUIDE_TICK_PX}`;
    const width = String(length).length * GUIDE_DIGIT_PX + 2 * GUIDE_LABEL_PADDING_PX;
    const height = GUIDE_LABEL_FONT_PX + 2 * GUIDE_LABEL_PADDING_PX;
    const [x, y] = labelOrigin(segment, width, height).map(Math.round);
    return `<path d="M${x1} ${y1}L${x2} ${y2}${tick(x1, y1)}${tick(x2, y2)}" stroke="${color}" stroke-width="1" fill="none" shape-rendering="crispEdges"/>` +
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${GUIDE_LABEL_RADIUS_PX}" fill="${color}"/>` +
        `<text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="central" font-size="${GUIDE_LABEL_FONT_PX}" font-weight="700" fill="#fff">${length}</text>`;
}

export function clearGuides() {
    drawnStage?.querySelector('.pref-guides').replaceChildren();
    drawnStage = null;
}

