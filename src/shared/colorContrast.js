// Text and hover colors of gnome-shell-light.css and gnome-shell-dark.css,
// for surfaces this extension paints itself and the theme cannot see.
export const THEME_FOREGROUND = Object.freeze({
    onLight: '#222226',
    onDark: '#ffffff',
});

export const THEME_HOVER_BACKGROUND = Object.freeze({
    onLight: 'rgba(0,0,0,0.1)',
    onDark: 'rgba(255,255,255,0.1)',
});

// Below this the desktop shows through, and the theme's own guess is better.
const OPAQUE_ALPHA_MIN = 0.5;

// Every stock accent stays below this and keeps white text, as GNOME does.
const LIGHT_LUMA_MIN = 0.6;

// Components are 0..1. Null means translucent, so nothing to contrast with.
export function backgroundIsLight({red, green, blue, alpha}) {
    if (alpha < OPAQUE_ALPHA_MIN)
        return null;
    return 0.299 * red + 0.587 * green + 0.114 * blue >= LIGHT_LUMA_MIN;
}
