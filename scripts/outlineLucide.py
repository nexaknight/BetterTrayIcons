"""Outlines a Lucide stroke icon into one filled path with Skia's stroker.

Usage: outlineLucide.py <lucide.svg> <out.svg>
Needs skia-python and svgelements, for example in a venv:
  python3 -m venv .venv && .venv/bin/pip install skia-python svgelements

GNOME recolors symbolic icons by forcing a fill on every shape, so a stroke
icon turns into solid discs. Path elements are parsed here so arcs reach
Skia as arcs, the other shapes go through svgelements.
"""
import math
import re
import sys

import skia
import svgelements as se

NUMBER = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')
ARGS = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7, 'Z': 0}


# The two arc flags are single digits and may touch the next number ("0 01-1 1"),
# so a plain number scan misreads them
def arguments(body, command):
    numbers = []
    pos = 0
    while pos < len(body):
        if command == 'A' and len(numbers) % 7 in (3, 4):
            match = re.compile(r'\s*,?\s*([01])').match(body, pos)
        else:
            match = re.compile(r'\s*,?\s*(' + NUMBER.pattern + ')').match(body, pos)
        if not match:
            break
        numbers.append(float(match.group(1)))
        pos = match.end()
    count = ARGS[command]
    return [numbers[i:i + count] for i in range(0, len(numbers), count)]


def path_from_data(d):
    p = skia.Path()
    x = y = 0.0
    cx = cy = None
    start = (0.0, 0.0)
    for cmd, body in re.findall(r'([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)', d):
        upper = cmd.upper()
        relative = cmd.islower()
        count = ARGS[upper]
        groups = arguments(body, upper) if count else [[]]
        for i, a in enumerate(groups):
            if upper == 'Z':
                p.close()
                x, y = start
                cx = cy = None
                continue
            ox, oy = (x, y) if relative else (0.0, 0.0)
            if upper == 'M':
                x, y = ox + a[0], oy + a[1]
                p.lineTo(x, y) if i else p.moveTo(x, y)
                if not i:
                    start = (x, y)
                cx = cy = None
            elif upper == 'L':
                x, y = ox + a[0], oy + a[1]
                p.lineTo(x, y)
                cx = cy = None
            elif upper == 'H':
                x = ox + a[0]
                p.lineTo(x, y)
                cx = cy = None
            elif upper == 'V':
                y = oy + a[0]
                p.lineTo(x, y)
                cx = cy = None
            elif upper in ('C', 'S'):
                if upper == 'C':
                    c1x, c1y, c2x, c2y, ex, ey = ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]
                else:
                    c1x, c1y = (2 * x - cx, 2 * y - cy) if cx is not None else (x, y)
                    c2x, c2y, ex, ey = ox + a[0], oy + a[1], ox + a[2], oy + a[3]
                p.cubicTo(c1x, c1y, c2x, c2y, ex, ey)
                cx, cy, x, y = c2x, c2y, ex, ey
            elif upper in ('Q', 'T'):
                if upper == 'Q':
                    qx, qy, ex, ey = ox + a[0], oy + a[1], ox + a[2], oy + a[3]
                else:
                    qx, qy = (2 * x - cx, 2 * y - cy) if cx is not None else (x, y)
                    ex, ey = ox + a[0], oy + a[1]
                p.quadTo(qx, qy, ex, ey)
                cx, cy, x, y = qx, qy, ex, ey
            elif upper == 'A':
                rx, ry, rotation, large, sweep, ex, ey = a[0], a[1], a[2], a[3], a[4], ox + a[5], oy + a[6]
                size = skia.Path.ArcSize.kLarge_ArcSize if large else skia.Path.ArcSize.kSmall_ArcSize
                direction = skia.PathDirection.kCW if sweep else skia.PathDirection.kCCW
                p.arcTo(rx, ry, rotation, size, direction, ex, ey)
                x, y = ex, ey
                cx = cy = None
    return p


def shape_path(shape):
    if isinstance(shape, se.Path):
        return path_from_data(shape.values['d'])
    p = skia.Path()
    for seg in se.Path(shape).segments():
        if isinstance(seg, se.Move):
            p.moveTo(seg.end.x, seg.end.y)
        elif isinstance(seg, se.Line):
            p.lineTo(seg.end.x, seg.end.y)
        elif isinstance(seg, se.CubicBezier):
            p.cubicTo(seg.control1.x, seg.control1.y, seg.control2.x, seg.control2.y, seg.end.x, seg.end.y)
        elif isinstance(seg, se.Arc):
            for c in seg.as_cubic_curves():
                p.cubicTo(c.control1.x, c.control1.y, c.control2.x, c.control2.y, c.end.x, c.end.y)
        elif isinstance(seg, se.Close):
            p.close()
    return p


def outline(svg_file):
    doc = se.SVG.parse(svg_file)
    width = float(doc.values.get('stroke-width', 2))
    paint = skia.Paint(StrokeWidth=width, StrokeCap=skia.Paint.kRound_Cap, StrokeJoin=skia.Paint.kRound_Join, Style=skia.Paint.kStroke_Style)
    union = None
    for shape in doc.elements(lambda e: isinstance(e, se.Shape)):
        filled = skia.Path()
        paint.getFillPath(shape_path(shape), filled)
        union = filled if union is None else skia.Op(union, filled, skia.PathOp.kUnion_PathOp)
    stream = skia.DynamicMemoryWStream()
    canvas = skia.SVGCanvas.Make(skia.Rect(0, 0, 24, 24), stream)
    canvas.drawPath(union, skia.Paint(Style=skia.Paint.kFill_Style))
    del canvas
    svg = bytes(stream.detachAsData()).decode()
    rule = 'evenodd' if union.getFillType() == skia.PathFillType.kEvenOdd else 'nonzero'
    return re.search(r' d="([^"]+)"', svg).group(1), rule


HEADER = '<!-- Derived from Lucide "{name}" (stroke outlined to fill). ISC - Copyright (c) 2026 Lucide Icons and Contributors -->'


def write_icon(source, target):
    d, rule = outline(source)
    name = re.sub(r'\.svg$', '', source.rsplit('/', 1)[-1])
    rule_attribute = ' fill-rule="evenodd"' if rule == 'evenodd' else ''
    with open(target, 'w') as out:
        out.write(HEADER.format(name=name) + '\n')
        out.write('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" version="1.1">\n')
        out.write(f'\t<path d="{d}" stroke="none" fill="#000"{rule_attribute}/>\n</svg>\n')


if __name__ == '__main__':
    write_icon(sys.argv[1], sys.argv[2])
