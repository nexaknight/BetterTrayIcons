import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {connectScoped} from '../../shared/lifecycle.js';
import {BOX_SIDES} from '../../shared/boxStyle.js';
import {
    GUIDE_LABEL_PADDING_PX, GUIDE_LABEL_RADIUS_PX, GUIDE_TICK_PX, containsPoint, labelOrigin, outset, sideSegment,
} from '../../shared/guideGeometry.js';
import {createBoundToggleButton} from './button.js';

// Measuring lines read as |--12--|, one per side, the value in a pill
// beside the line.
const GUIDE_KEYS = Object.freeze({padding: 'preview-show-padding', margin: 'preview-show-margin'});
const GUIDE_MARGIN_RGB = Object.freeze([1.0, 0.47, 0.0]);
const GUIDE_LABEL_FONT = 'Sans Bold 8';
const GUIDE_LABEL_TEXT_RGB = Object.freeze([1, 1, 1]);

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
            return box && containsPoint(outset(box, guide.margin), x, y);
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
            _drawMeasure(cr, sideSegment(box, side, margin[side], {isOutward: true}), GUIDE_MARGIN_RGB);
        if (show.padding)
            _drawMeasure(cr, sideSegment(inner, side, padding[side], {isOutward: false}), accentRgb);
    }
}

function _drawMeasure(cr, segment, [red, green, blue]) {
    const {isVertical, length, x1, y1, x2, y2} = segment;
    const snap = value => Math.round(value) + 0.5;
    cr.setSourceRGB(red, green, blue);
    cr.setLineWidth(1);
    cr.moveTo(snap(x1), snap(y1));
    cr.lineTo(snap(x2), snap(y2));
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
        if (isVertical) {
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
    const [x, y] = labelOrigin(segment, width, height).map(Math.round);
    _roundedRect(cr, x, y, width, height, GUIDE_LABEL_RADIUS_PX);
    cr.fill();
    cr.setSourceRGB(...GUIDE_LABEL_TEXT_RGB);
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

function _inset(box, sides) {
    return {
        x: box.x + sides.left,
        y: box.y + sides.top,
        width: Math.max(0, box.width - sides.left - sides.right),
        height: Math.max(0, box.height - sides.top - sides.bottom),
    };
}
