import {DISPLAY_MODE} from '../const.js';

export const TOGGLE_ICON_KEYS = Object.freeze([
    'toggle-icon-name',
    'toggle-icon-active-name',
    'toggle-icon-rotate',
    'toggle-icon-rotate-angle',
    'toggle-icon-rotate-reverse',
    'toggle-icon-rotate-animate',
    'toggle-icon-rotate-duration',
    'toggle-icon-rotate-delay',
]);

export function drawerToggleIconKey(key) {
    return `drawer-${key}`;
}

export const DRAWER_TOGGLE_ICON_KEYS = Object.freeze(TOGGLE_ICON_KEYS.map(drawerToggleIconKey));

export function toggleIconKey(settings, key) {
    return settings.get_string('display-mode') === DISPLAY_MODE.DRAWER ? drawerToggleIconKey(key) : key;
}

export function toggleIconName(settings, key) {
    const modeKey = toggleIconKey(settings, key);
    return settings.get_string(modeKey) || settings.get_default_value(modeKey).unpack();
}
