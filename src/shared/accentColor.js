// A color key set to this follows the system accent. The replaced color
// rides along behind it, so switching the accent off restores it.
export const ACCENT_COLOR_VALUE = 'accent';

const ACCENT_PREFIX = `${ACCENT_COLOR_VALUE}:`;

export function usesAccent(value) {
    return value === ACCENT_COLOR_VALUE || `${value}`.startsWith(ACCENT_PREFIX);
}

export function accentValueKeeping(previous) {
    return usesAccent(previous) ? previous : `${ACCENT_PREFIX}${previous}`;
}

export function colorBehindAccent(value) {
    return `${value}`.startsWith(ACCENT_PREFIX) ? value.slice(ACCENT_PREFIX.length) : null;
}
