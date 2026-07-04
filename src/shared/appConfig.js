import {warn} from './logging.js';
import {deleteCachedIcon} from './icon.js';
import {RESERVED_OBJECT_KEYS} from '../const.js';

// Drops reserved keys so untrusted JSON (e.g. a sync file) can't reach
// Object.prototype. `transform` returning null skips the entry.
export function safeMapFromParsed(src, transform = (_k, v) => v) {
    const map = Object.create(null);
    if (!src || typeof src !== 'object' || Array.isArray(src))
        return map;
    for (const [key, val] of Object.entries(src)) {
        if (RESERVED_OBJECT_KEYS.has(key))
            continue;
        const next = transform(key, val);
        if (next != null)
            map[key] = next;
    }
    return map;
}

export function formatAppName(input) {
    if (!input)
        return '';

    let name = input;
    if (name.includes('.')) {
        const parts = name.split('.');
        name = parts[parts.length - 1];
    }

    return name.charAt(0).toUpperCase() + name.slice(1);
}

export function getAppConfigMap(settings) {
    if (!settings)
        return Object.create(null);
    try {
        const jsonString = settings.get_string('app-configs');
        if (!jsonString)
            return Object.create(null);
        return safeMapFromParsed(JSON.parse(jsonString));
    } catch (e) {
        warn(`Error parsing app-configs: ${e.message}`);
        return Object.create(null);
    }
}

export function getAppConfigs(settings) {
    const map = getAppConfigMap(settings);
    return Object.entries(map).map(([id, data]) => ({
        id,
        ...data,
    }));
}

export function getAppConfigValue(settings, appId, key, defaultValue = null) {
    const map = getAppConfigMap(settings);
    if (map[appId] && map[appId][key] !== undefined)
        return map[appId][key];

    return defaultValue;
}

export function setAppConfigValue(settings, appId, key, value) {
    if (!settings || !appId)
        return;
    const map = getAppConfigMap(settings);
    if (!map[appId])
        map[appId] = {};

    if (map[appId][key] === value)
        return;

    map[appId][key] = value;
    settings.set_string('app-configs', JSON.stringify(map));
}

export function removeAppConfigKey(settings, appId, key) {
    if (!settings || !appId)
        return;
    const map = getAppConfigMap(settings);
    if (!map[appId])
        return;

    delete map[appId][key];
    settings.set_string('app-configs', JSON.stringify(map));
}

export function deleteAppConfig(settings, appId) {
    if (!settings || !appId)
        return;
    const map = getAppConfigMap(settings);
    if (map[appId]) {
        delete map[appId];
        settings.set_string('app-configs', JSON.stringify(map));
        deleteCachedIcon(appId);
    }
}

// Skip null/undefined/empty values so a failed detection doesn't
// overwrite the last good one.
export function updateAppConfig(settings, appId, detectedData) {
    if (!settings || !appId)
        return;

    const map = getAppConfigMap(settings);
    const existing = map[appId] || {};

    const merged = {};
    for (const [k, v] of Object.entries(detectedData)) {
        if (v !== null && v !== undefined && v !== '')
            merged[k] = v;
    }


    let changed = !map[appId];
    for (const k of Object.keys(merged)) {
        if (existing[k] !== merged[k]) {
            changed = true;
            break;
        }
    }

    if (!changed)
        return;

    map[appId] = {
        ...existing,
        ...merged,
        is_hidden: existing.is_hidden ?? false,
        priority: existing.priority ?? 0,
        custom_icon: existing.custom_icon ?? null,
    };

    settings.set_string('app-configs', JSON.stringify(map));
}
