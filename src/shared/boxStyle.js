// Both processes build the same box from the same keys, the shell into an inline
// St style and prefs into a GTK sheet. Only the color lookup differs, so that
// arrives as a callback.

// Order matters, a padding or margin shorthand reads the sides in this order.
export const BOX_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);

function sidesShorthand(settings, keyPrefix, minPerSide = {}) {
    return BOX_SIDES
        .map(side => Math.max(settings.get_int(`${keyPrefix}-${side}`), minPerSide[side] || 0))
        .map(px => `${px}px`)
        .join(' ');
}

// A missing color would leave a shorthand the style engine cannot parse, and
// the theme border would bleed through instead of staying stripped.
export function borderShorthand(settings, keyPrefix, resolveColor) {
    const color = resolveColor(`${keyPrefix}-border-color`);
    return color ? `${settings.get_int(`${keyPrefix}-border-width`)}px solid ${color}` : '0px';
}

export function boxGeometryCss(settings, {spacingPrefix, radiusPrefix = spacingPrefix, minMargin = {}}) {
    return `padding: ${sidesShorthand(settings, `${spacingPrefix}-padding`)};` +
        ` margin: ${sidesShorthand(settings, `${spacingPrefix}-margin`, minMargin)};` +
        ` border-radius: ${settings.get_int(`${radiusPrefix}-border-radius`)}px;`;
}
