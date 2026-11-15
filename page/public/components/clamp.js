// AdwClamp's defaults, Adw.PreferencesPage keeps them for the prefs pages
// and for every dialog under src/prefs
const CLAMP_MAXIMUM_PX = 600;
const CLAMP_THRESHOLD_PX = 400;
const EASE_OUT_TAN_CUBIC = 3;

// The space at each side of the clamped content, on the scroller that plays
// the clamp's viewport. AdwClampLayout centers in whole pixels, an odd
// remainder goes to the end side.
export function applyClamp(scroller) {
    const available = scroller.clientWidth;
    const margin = available - adwClampWidth(available);
    const start = Math.floor(margin / 2);
    scroller.style.setProperty('--clamp-start', `${start}px`);
    scroller.style.setProperty('--clamp-end', `${margin - start}px`);
}

// Source: child_size_from_clamp in https://gitlab.gnome.org/GNOME/libadwaita/-/blob/1.9.4/src/adw-clamp-layout.c
// Full width up to the threshold, the maximum past three times the
// maximum's distance from it, an ease out cubic in between
function adwClampWidth(available) {
    const upper = CLAMP_THRESHOLD_PX + EASE_OUT_TAN_CUBIC * (CLAMP_MAXIMUM_PX - CLAMP_THRESHOLD_PX);
    if (available <= CLAMP_THRESHOLD_PX)
        return available;
    if (available >= upper)
        return CLAMP_MAXIMUM_PX;
    const progress = (available - CLAMP_THRESHOLD_PX) / (upper - CLAMP_THRESHOLD_PX);
    const eased = 1 + (progress - 1) ** 3;
    return Math.floor(CLAMP_THRESHOLD_PX + (CLAMP_MAXIMUM_PX - CLAMP_THRESHOLD_PX) * eased);
}
