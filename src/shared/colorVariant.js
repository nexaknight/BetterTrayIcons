// Plain keys hold the dark colors, the `-light` twins the light ones.
export const LIGHT_SUFFIX = '-light';

// Prefs edit the set this points at, the shell picks its own from the session.
export const COLOR_VARIANT_KEY = 'color-variant-editing';

export function lightTwin(key) {
    return `${key}${LIGHT_SUFFIX}`;
}

export function withLightTwins(colorKeys) {
    return colorKeys.flatMap(key => [key, lightTwin(key)]);
}

const SPLIT_KEY_BY_PREFIX = [
    ['toggle-icon-', 'toggle-icon-color-split'],
    ['icon-', 'icon-color-split'],
    ['overflow-container-', 'overflow-container-color-split'],
];

export const SPLIT_COLOR_KEYS = Object.freeze(SPLIT_KEY_BY_PREFIX.map(([, key]) => key));

export function splitKeyFor(colorKey) {
    return SPLIT_KEY_BY_PREFIX.find(([prefix]) => colorKey.startsWith(prefix))[1];
}

export function colorKeyFor(settings, key, light) {
    return light && settings.get_boolean(splitKeyFor(key)) ? lightTwin(key) : key;
}
