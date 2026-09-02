import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {connectScoped} from '../../shared/lifecycle.js';
import {BOX_SIDES} from '../../shared/boxStyle.js';
import {createBoundToggleButton} from './button.js';

// Measuring lines read as |--12--|, one per side, the value in a pill
// beside the line.
const GUIDE_KEYS = Object.freeze({padding: 'preview-show-padding', margin: 'preview-show-margin'});
const GUIDE_MARGIN_RGB = Object.freeze([1.0, 0.47, 0.0]);
const GUIDE_TICK_PX = 3;
const GUIDE_LABEL_FONT = 'Sans Bold 8';
const GUIDE_LABEL_PADDING_PX = 3;
const GUIDE_LABEL_RADIUS_PX = 4;
const GUIDE_LABEL_GAP_PX = 3;

export function createGuideToggle(settings, kind, tooltip) {
    const button = createBoundToggleButton(settings, GUIDE_KEYS[kind], {iconName: `bti-${kind}-symbolic`, tooltip});
    button.add_css_class('bti-guide-toggle');
    button.add_css_class(kind);
    return button;
}

// The guide under the pointer gets the lines, else the first one.
export function bindGuideOverlay(group, stage, settings) {
    let guides = [];
    let hoveredGuide = null;
    let isHovering = false;
    const shown = () => ({
        padding: settings.get_boolean(GUIDE_KEYS.padding),
        margin: settings.get_boolean(GUIDE_KEYS.margin),
    });
    const syncGuides = () => {
        const {padding, margin} = shown();
        stage.guides.visible = isHovering && (padding || margin) && guides.length > 0;
        stage.guides.queue_draw();
    };
    stage.guides.set_draw_func((area, cr) => _drawGuides(area, cr, hoveredGuide ?? guides[0], shown()));
    const hover = new Gtk.EventControllerMotion();
    hover.connect('enter', () => {
        isHovering = true;
        syncGuides();
    });
    hover.connect('leave', () => {
        isHovering = false;
        syncGuides();
    });
    hover.connect('motion', (_controller, x, y) => {
        const hit = guides.find(guide => {
            const box = _boundsOf(guide.target, stage.guides);
            return box && _containsPoint(_outset(box, guide.margin), x, y);
        }) ?? null;
        if (hit === hoveredGuide)
            return;
        hoveredGuide = hit;
        stage.guides.queue_draw();
    });
    stage.add_controller(hover);
    Object.values(GUIDE_KEYS).forEach(key => connectScoped(group, settings, `changed::${key}`, syncGuides));

    return nextGuides => {
        guides = nextGuides;
        hoveredGuide = null;
        syncGuides();
    };
}

// Only what the page can edit gets a guide, stock spacing is fixed.
export function spacingGuides(settings, switchKey, targets, {spacingPrefix, borderPrefix}) {
    if (!settings.get_boolean(switchKey))
        return [];
    const sides = keyPrefix => Object.fromEntries(BOX_SIDES.map(side => [side, settings.get_int(`${keyPrefix}-${side}`)]));
    const padding = sides(`${spacingPrefix}-padding`);
    const margin = sides(`${spacingPrefix}-margin`);
    const border = settings.get_int(`${borderPrefix}-border-width`);
    return targets.map(target => ({target, padding, margin, border}));
}

// compute_bounds hands back the border box, so padding measures inward
// from the border's inner edge and margin outward from the box.
function _drawGuides(area, cr, guide, show) {
    const box = guide ? _boundsOf(guide.target, area) : null;
    if (box)
        _drawMeasures(cr, box, guide, show);
    cr.$dispose();
}

function _drawMeasures(cr, box, {padding, margin, border}, show) {
    const accent = Adw.StyleManager.get_default().get_accent_color_rgba();
    const accentRgb = [accent.red, accent.green, accent.blue];
    const inner = _inset(box, Object.fromEntries(BOX_SIDES.map(side => [side, border])));
    for (const side of BOX_SIDES) {
        if (show.margin)
            _drawMeasure(cr, _sideSegment(box, side, margin[side], {outward: true}), GUIDE_MARGIN_RGB);
        if (show.padding)
            _drawMeasure(cr, _sideSegment(inner, side, padding[side], {outward: false}), accentRgb);
    }
}

// A side measures along its own axis, centered on the other one.
function _sideSegment(box, side, length, {outward}) {
    const vertical = side === 'top' || side === 'bottom';
    const edge = {top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width}[side];
    const inwardSign = side === 'top' || side === 'left' ? 1 : -1;
    const end = edge + (outward ? -inwardSign : inwardSign) * length;
    const center = vertical ? box.x + box.width / 2 : box.y + box.height / 2;
    return {
        side,
        outward,
        vertical,
        length,
        x1: vertical ? center : edge,
        y1: vertical ? edge : center,
        x2: vertical ? center : end,
        y2: vertical ? end : center,
    };
}

// A margin label sits past the line's outer end, a padding label in its side's
// own corner, so eight labels around a small icon stay apart.
function _labelOrigin({side, outward, x1, y1, x2, y2}, width, height) {
    const gap = GUIDE_LABEL_GAP_PX;
    if (outward) {
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

function _drawMeasure(cr, segment, [red, green, blue]) {
    const {vertical, length, x1, y1, x2, y2} = segment;
    const snap = value => Math.round(value) + 0.5;
    cr.setSourceRGB(red, green, blue);
    cr.setLineWidth(1);
    cr.moveTo(snap(x1), snap(y1));
    cr.lineTo(snap(x2), snap(y2));
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
        if (vertical) {
            cr.moveTo(snap(x) - GUIDE_TICK_PX, snap(y));
            cr.lineTo(snap(x) + GUIDE_TICK_PX, snap(y));
        } else {
            cr.moveTo(snap(x), snap(y) - GUIDE_TICK_PX);
            cr.lineTo(snap(x), snap(y) + GUIDE_TICK_PX);
        }
    }
    cr.stroke();

    const layout = PangoCairo.create_layout(cr);
    layout.set_font_description(Pango.FontDescription.from_string(GUIDE_LABEL_FONT));
    layout.set_text(String(length), -1);
    const [textWidth, textHeight] = layout.get_pixel_size();
    const width = textWidth + 2 * GUIDE_LABEL_PADDING_PX;
    const height = textHeight + 2 * GUIDE_LABEL_PADDING_PX;
    const [x, y] = _labelOrigin(segment, width, height).map(Math.round);
    _roundedRect(cr, x, y, width, height, GUIDE_LABEL_RADIUS_PX);
    cr.fill();
    cr.setSourceRGB(1, 1, 1);
    cr.moveTo(x + GUIDE_LABEL_PADDING_PX, y + GUIDE_LABEL_PADDING_PX);
    PangoCairo.show_layout(cr, layout);
}

function _roundedRect(cr, x, y, width, height, radius) {
    const quarter = Math.PI / 2;
    cr.newSubPath();
    cr.arc(x + width - radius, y + radius, radius, -quarter, 0);
    cr.arc(x + width - radius, y + height - radius, radius, 0, quarter);
    cr.arc(x + radius, y + height - radius, radius, quarter, 2 * quarter);
    cr.arc(x + radius, y + radius, radius, 2 * quarter, 3 * quarter);
    cr.closePath();
}

function _boundsOf(widget, target) {
    const [found, bounds] = widget.compute_bounds(target);
    return found
        ? {x: bounds.origin.x, y: bounds.origin.y, width: bounds.size.width, height: bounds.size.height}
        : null;
}

function _containsPoint(box, x, y) {
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function _outset(box, sides) {
    return {
        x: box.x - sides.left,
        y: box.y - sides.top,
        width: box.width + sides.left + sides.right,
        height: box.height + sides.top + sides.bottom,
    };
}

function _inset(box, sides) {
    return {
        x: box.x + sides.left,
        y: box.y + sides.top,
        width: Math.max(0, box.width - sides.left - sides.right),
        height: Math.max(0, box.height - sides.top - sides.bottom),
    };
}
