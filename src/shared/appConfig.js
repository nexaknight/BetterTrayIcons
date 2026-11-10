import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {warnOnce} from './logging.js';
import {deleteCachedIcon} from './iconLoading.js';
import {readFileBytes} from './asyncIo.js';
import {clearIds, connectScoped, debounceTo, disposeAll, removeTimer} from './lifecycle.js';

// Gaps of 10 leave room for manual reorder edits between drags.
const PRIORITY_STEP = 10;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export const WHEN_IN_FRONT_NONE = 'none';
export const WHEN_IN_FRONT_MINIMIZE = 'minimize';

export const SCROLL_ACTION_DEFAULT = 'default';

// The shell writes these itself while it identifies apps and resolves their
// icons, so they move without the user touching anything. Off the sync path
// they can't rearm the auto-push debounce faster than it expires.
const RUNTIME_APP_CONFIG_FIELDS = Object.freeze([
    'detected_icon',
    'detected_icon_hash',
    'icon_theme_path',
    'cached_icon_path',
    'seen_icons',
    'title',
    'is_wine',
    'is_proton',
    'is_xembed',
    'is_background_proxy',
    'is_foreign',
    'packaging',
    'migrated_to',
]);

// The item lives only while the extension that handed it in is loaded here,
// so the entry stays off the sync path rather than reaching a host where
// nothing answers to the id.
export const isForeignConfig = entry => entry?.is_foreign === true;

const TRAY_CONFIG_RENDER_FIELDS = Object.freeze([
    'is_hidden',
    'custom_title',
    'custom_icon',
    'cached_icon_path',
    'detected_icon',
    'detected_icon_hash',
    'icon_theme_path',
    'state_icons',
    'unread_badge',
    'badge_style',
]);

// The underscores keep the SNI NeedsAttention key out of the icon-name
// namespace.
export const ATTENTION_STATE_KEY = '__attention__';

const SEEN_STATE_ICONS_MAX = 12;

// Electron bumps a counter name on every icon change, so these names
// identify no state and would flood the seen list. Chromium appends
// -symbolic to the same counter for vector icons.
const VOLATILE_ICON_NAME_PATTERNS = Object.freeze([
    /^status_icon_\d+(-symbolic)?$/i,
]);

// Untrusted JSON (a sync file, a hand-edited blob) must not be able to set
// these. Assigning __proto__ on a plain object runs the inherited setter and
// swaps that object's prototype, the other two shadow inherited members.
export const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function safeMapFromParsed(src, transform = (_k, v) => v) {
    const map = Object.create(null);
    if (!src || typeof src !== 'object' || Array.isArray(src))
        return map;
    for (const [key, val] of Object.entries(src)) {
        if (RESERVED_OBJECT_KEYS.has(key))
            continue;
        try {
            const next = transform(key, val);
            if (next != null)
                map[key] = next;
        } catch (e) {
            warnOnce(`app-config-entry:${key}`, `Dropping malformed app config '${key}': ${e.message}`);
        }
    }
    return map;
}

export function formatAppName(input) {
    if (typeof input !== 'string' || !input)
        return '';

    const name = input.split('.').pop();
    return name.charAt(0).toUpperCase() + name.slice(1);
}

export function displayAppName(config, fallbackId = null) {
    const custom = config.custom_title;
    if (typeof custom === 'string' && custom)
        return custom;
    return defaultAppName(config, fallbackId);
}

export function defaultAppName(config, fallbackId = null) {
    // The owner hands in a name meant for the user, and cutting at the last
    // dot would leave a fragment of it.
    if (isForeignConfig(config) && config.title)
        return config.title;
    return formatAppName(config.title || fallbackId);
}

export function getAppConfigMap(settings) {
    try {
        const jsonString = settings.get_string('app-configs');
        if (!jsonString)
            return Object.create(null);
        return safeMapFromParsed(JSON.parse(jsonString));
    } catch (e) {
        warnOnce('app-configs-parse', `Error parsing app-configs: ${e.message}`);
        return Object.create(null);
    }
}

function _saveMap(settings, map) {
    settings.set_string('app-configs', JSON.stringify(map));
    _syncStamp(settings, map);
}

export function getSyncMeta(settings) {
    try {
        const raw = settings.get_string('app-config-sync-meta');
        if (!raw)
            return _emptyMeta();
        const parsed = JSON.parse(raw);
        return {entries: _plainMap(parsed.entries), tombstones: _plainMap(parsed.tombstones)};
    } catch (e) {
        warnOnce('sync-meta-parse', `Error parsing app-config-sync-meta: ${e.message}`);
        return _emptyMeta();
    }
}

function _emptyMeta() {
    return {entries: Object.create(null), tombstones: Object.create(null)};
}

function _plainMap(src) {
    const map = Object.create(null);
    if (!src || typeof src !== 'object' || Array.isArray(src))
        return map;

    for (const [key, val] of Object.entries(src)) {
        if (!RESERVED_OBJECT_KEYS.has(key))
            map[key] = val;
    }
    return map;
}

function _saveSyncMeta(settings, meta) {
    settings.set_string('app-config-sync-meta', JSON.stringify(meta));
}

function userConfigFields(entry) {
    // Nothing at all for a foreign item, so the signature that arms the auto
    // push never moves when one arrives, goes or is reordered.
    if (isForeignConfig(entry))
        return {};

    const own = {};
    // Sorted so the hash and the signature don't depend on insertion order.
    for (const key of Object.keys(entry).sort()) {
        if (!RUNTIME_APP_CONFIG_FIELDS.includes(key))
            own[key] = entry[key];
    }
    return own;
}

function _entryHash(entry) {
    const json = JSON.stringify(userConfigFields(entry));
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < json.length; i++) {
        hash ^= json.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash.toString(16);
}

// Stamps keep rising even if the wall clock jumps back on an NTP correction,
// and a peer's future stamp carries forward after a merge.
function _nextStamp(meta) {
    let max = 0;
    for (const entry of Object.values(meta.entries))
        max = Math.max(max, entry?.m || 0);
    for (const stamp of Object.values(meta.tombstones))
        max = Math.max(max, stamp || 0);
    return Math.max(Date.now(), max + 1);
}

function _syncStamp(settings, map) {
    const meta = getSyncMeta(settings);
    const now = _nextStamp(meta);
    let changed = false;

    for (const appId of Object.keys(map)) {
        const hash = _entryHash(map[appId]);
        if (meta.entries[appId]?.h !== hash) {
            meta.entries[appId] = {m: now, h: hash};
            delete meta.tombstones[appId];
            changed = true;
        }
    }
    for (const appId of Object.keys(meta.entries)) {
        if (!(appId in map)) {
            delete meta.entries[appId];
            meta.tombstones[appId] = now;
            changed = true;
        }
    }

    if (changed)
        _saveSyncMeta(settings, meta);
}

// A migration re-keys an entry, it is not a user forget, so the old id must not
// travel to other hosts as a deletion. They re-key their own copy on identify.
function _dropTombstone(settings, appId) {
    const meta = getSyncMeta(settings);
    if (meta.tombstones[appId]) {
        delete meta.tombstones[appId];
        _saveSyncMeta(settings, meta);
    }
}

// Last-writer-wins element set. A tombstone newer than the live entry deletes
// it so a forget propagates, a tie keeps the live entry and then the greater
// content hash, so both hosts reach the same result without coordinating.
export function mergeAppConfigs(localMap, localMeta, incomingMap, incomingMeta, incomingFallbackTs) {
    const now = _nextStamp(localMeta);
    const incomingEntries = incomingMeta?.entries ?? {};
    const incomingTombstones = incomingMeta?.tombstones ?? {};

    const localLive = id => id in localMap ? localMeta.entries[id]?.m ?? now : -Infinity;
    const incomingLive = id => id in incomingMap
        ? incomingEntries[id]?.m ?? incomingFallbackTs : -Infinity;

    const ids = new Set([
        ...Object.keys(localMap), ...Object.keys(incomingMap),
        ...Object.keys(localMeta.tombstones), ...Object.keys(incomingTombstones),
    ]);

    const map = Object.create(null);
    const entries = Object.create(null);
    const tombstones = Object.create(null);

    for (const id of ids) {
        const liveLocal = localLive(id);
        const liveIncoming = incomingLive(id);
        const bestLive = Math.max(liveLocal, liveIncoming);
        const bestTombstone = Math.max(
            localMeta.tombstones[id] ?? -Infinity, incomingTombstones[id] ?? -Infinity);

        if (bestLive > -Infinity && bestLive >= bestTombstone) {
            const takeIncoming = liveIncoming > liveLocal ||
                (liveIncoming === liveLocal && _entryHash(incomingMap[id]) > _entryHash(localMap[id]));
            const entry = takeIncoming ? incomingMap[id] : localMap[id];
            map[id] = entry;
            entries[id] = {m: bestLive, h: _entryHash(entry)};
        } else if (bestTombstone > -Infinity) {
            tombstones[id] = bestTombstone;
        }
    }

    return {map, meta: {entries, tombstones}};
}

export function syncMetaForReplace(map, incomingMeta, fallbackTs) {
    const entries = Object.create(null);
    const incomingEntries = incomingMeta?.entries ?? {};
    for (const appId of Object.keys(map))
        entries[appId] = {m: incomingEntries[appId]?.m ?? fallbackTs, h: _entryHash(map[appId])};
    return {entries, tombstones: _plainMap(incomingMeta?.tombstones)};
}

export function configRenderDelta(settings, appId, lastSig) {
    const entry = getAppConfigMap(settings)[appId] ?? {};
    const sig = JSON.stringify(TRAY_CONFIG_RENDER_FIELDS.map(field => entry[field]));
    return {entry, sig, changed: sig !== lastSig};
}

export function unreadBadgeEnabled(entry) {
    return !!entry?.custom_icon && entry?.unread_badge === true;
}

export function userConfigSignature(settings) {
    const map = getAppConfigMap(settings);
    const kept = {};
    for (const appId of Object.keys(map).sort()) {
        const own = userConfigFields(map[appId]);
        if (Object.keys(own).length > 0)
            kept[appId] = own;
    }
    return JSON.stringify(kept);
}

export function getAppConfigs(settings) {
    const map = getAppConfigMap(settings);
    return Object.entries(map).map(([id, data]) => ({
        id,
        ...data,
    }));
}

export function getAppConfigValue(settings, appId, key, defaultValue = null, map = null) {
    const configMap = map ?? getAppConfigMap(settings);
    const entry = configMap[appId];
    if (entry && entry[key] !== undefined)
        return entry[key];
    return defaultValue;
}

// Configs from before the close option carry a minimize-only boolean
export function whenInFrontOf(entry) {
    return entry?.when_in_front ?? (entry?.minimize_when_focused === true ? WHEN_IN_FRONT_MINIMIZE : WHEN_IN_FRONT_NONE);
}

export function setAppConfigValue(settings, appId, key, value) {
    if (!appId)
        return;

    const map = getAppConfigMap(settings);
    const entry = map[appId];

    if (value === null) {
        if (!entry || entry[key] === undefined)
            return;
        delete entry[key];
        _saveMap(settings, map);
        return;
    }

    if (!entry)
        map[appId] = {};
    if (map[appId][key] === value)
        return;

    map[appId][key] = value;
    _saveMap(settings, map);
}

// Reads fresh at write time so a caller holding a stale snapshot can't
// clobber a concurrent write to other keys.
export function mutateAppConfig(settings, appId, mutate) {
    if (!appId)
        return;
    const map = getAppConfigMap(settings);
    const entry = map[appId] ?? (map[appId] = {});
    if (mutate(entry) === false)
        return;
    _saveMap(settings, map);
}

export function findStateIconEntry(stateIcons, name) {
    if (!stateIcons || !name)
        return null;
    for (const [key, value] of Object.entries(stateIcons)) {
        if (sameStateKey(key, name))
            return [key, value];
    }
    return null;
}

export function isVolatileIconName(name) {
    const base = stateNameOf(name);
    return !!base && VOLATILE_ICON_NAME_PATTERNS.some(pattern => pattern.test(base));
}

// Apps like Cloudflare WARP report one absolute file path per state, the
// basename still names the state.
export function stateNameOf(icon) {
    if (!icon || !icon.startsWith('/'))
        return icon;
    const base = icon.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
    return base || null;
}

// Without this an app rotating through more names than the cap re-adds an
// evicted one on every resolve, and each re-add is a full blob write.
const _sessionSeen = new Map();

export function recordSeenStateIcons(settings, appId, names, map = null) {
    if (!appId)
        return;
    const usable = names.map(stateNameOf).filter(name =>
        name && !isVolatileIconName(name));
    if (usable.length === 0)
        return;

    const configMap = map ?? getAppConfigMap(settings);
    const entry = configMap[appId];
    if (!entry)
        return;

    let changed = false;
    const known = _sessionSeen.get(appId) ?? new Set();
    _sessionSeen.set(appId, known);

    const seen = Array.isArray(entry.seen_icons) ? entry.seen_icons : [];
    // An emptied persisted list means the entry was forgotten, possibly by
    // the prefs process whose dedup set this one can't see. Start over.
    if (seen.length === 0 && known.size > 0)
        known.clear();
    for (const name of usable) {
        const key = normalizeStateKey(name);
        if (known.has(key))
            continue;
        known.add(key);
        if (seen.some(s => sameStateKey(s, name)))
            continue;
        seen.push(name);
        changed = true;
    }
    if (changed) {
        while (seen.length > SEEN_STATE_ICONS_MAX)
            seen.shift();
        entry.seen_icons = seen;
    }

    if (adoptReportedCasing(entry.state_icons, usable))
        changed = true;

    if (changed)
        _saveMap(settings, configMap);
}

function adoptReportedCasing(states, names) {
    if (!states)
        return false;

    let changed = false;
    for (const name of names) {
        // An app-reported name is untrusted, never let it become a reserved key.
        if (RESERVED_OBJECT_KEYS.has(name))
            continue;
        for (const key of Object.keys(states)) {
            if (key === name || !sameStateKey(key, name))
                continue;
            states[name] = states[key];
            delete states[key];
            changed = true;
        }
    }
    return changed;
}

function normalizeStateKey(name) {
    return (name ?? '').trim().toLowerCase();
}

export function sameStateKey(a, b) {
    return normalizeStateKey(a) === normalizeStateKey(b);
}

// Ties would otherwise keep Map insertion order, which is the completion
// order of the async proxy setups, so a fresh install shuffles its tray on
// every login until the user assigns priorities.
export function byPriorityThenAppId(a, b) {
    return b.priority - a.priority || (a.appId ?? '').localeCompare(b.appId ?? '');
}

const RUNTIME_DIR = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'bettertrayicons']);

// The config blob lists closed and uninstalled apps, so numbering from it
// would not match the panel.
const VISIBLE_ORDER_PATH = GLib.build_filenamev([RUNTIME_DIR, 'visible-order.json']);

// detected_icon is the calm baseline the alert check compares against, so
// what a running item shows right now travels here instead.
export const SHOWN_ICONS_PATH = GLib.build_filenamev([RUNTIME_DIR, 'shown-icons.json']);

// The prefs show the all-monitors switch only while the shell has a panel
// on a second monitor to mirror onto.
const SECONDARY_PANELS_PATH = GLib.build_filenamev([RUNTIME_DIR, 'secondary-panels.json']);
// A replace lands as a burst of monitor events with a gap where the file is
// gone or empty, reading too early flips the watchers back and forth
const RUNTIME_READ_SETTLE_MS = 150;

export async function readVisibleOrder() {
    const ids = await _readRuntimeJson(VISIBLE_ORDER_PATH);
    return Array.isArray(ids) && ids.length ? ids : null;
}

export function publishVisibleOrder(appIds) {
    _publishRuntimeJson(VISIBLE_ORDER_PATH, appIds);
}

export function clearVisibleOrder() {
    _deleteRuntimeFile(VISIBLE_ORDER_PATH);
}

export async function readShownIcons() {
    return await _readRuntimeJson(SHOWN_ICONS_PATH) ?? {};
}

export function publishShownIcons(iconsByAppId) {
    _publishRuntimeJson(SHOWN_ICONS_PATH, iconsByAppId);
}

export function clearShownIcons() {
    _deleteRuntimeFile(SHOWN_ICONS_PATH);
}

export function publishSecondaryPanels(hasSecondary) {
    _publishRuntimeJson(SECONDARY_PANELS_PATH, hasSecondary);
}

export function clearSecondaryPanels() {
    _deleteRuntimeFile(SECONDARY_PANELS_PATH);
}

export function watchSecondaryPanels(widget, onChange) {
    watchRuntimeFile(widget, SECONDARY_PANELS_PATH,
        async () => await _readRuntimeJson(SECONDARY_PANELS_PATH) === true, onChange);
}

// The shell replaces the file whole and deletes it on disable, a missing file
// reads as nothing running.
export function watchRuntimeFile(widget, path, read, onChange, event = null) {
    const monitorProp = `_runtimeMonitor:${path}`;
    const timerProp = `_runtimeReadId:${path}`;
    widget[monitorProp] = Gio.File.new_for_path(path).monitor_file(Gio.FileMonitorFlags.NONE, null);
    connectScoped(widget, widget[monitorProp], 'changed',
        () => debounceTo(widget, timerProp, RUNTIME_READ_SETTLE_MS, () => read().then(onChange)), event);
    widget.connect(event ?? 'destroy', () => {
        disposeAll(widget, 'cancel', monitorProp);
        clearIds(widget, removeTimer, timerProp);
    });
    read().then(onChange);
}

async function _readRuntimeJson(path) {
    try {
        const bytes = await readFileBytes(Gio.File.new_for_path(path));
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
}

let _isRuntimeDirMade = false;

// Every rewrite wakes each prefs watcher and flickers what it shows, so the
// same content is not written twice
const _lastPublished = new Map();

// A disable deletes what the next enable writes again. Each path runs its
// writes and deletes in call order, so a late delete never wipes a new file.
const _runtimeFileQueues = new Map();

function _publishRuntimeJson(path, value) {
    const json = JSON.stringify(value);
    if (_lastPublished.get(path) === json)
        return;
    _lastPublished.set(path, json);
    _queueRuntimeFileOp(path, async () => {
        try {
            await _makeRuntimeDir();
            await Gio.File.new_for_path(path).replace_contents_async(
                new GLib.Bytes(new TextEncoder().encode(json)),
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch {
            // Runtime dir gone, prefs fall back to the config meanwhile and
            // the next publish makes the folder again
            _isRuntimeDirMade = false;
            if (_lastPublished.get(path) === json)
                _lastPublished.delete(path);
        }
    });
}

// XDG_RUNTIME_DIR is 0700 by spec, so the folder needs no mode of its own
async function _makeRuntimeDir() {
    if (_isRuntimeDirMade)
        return;
    try {
        await Gio.File.new_for_path(RUNTIME_DIR).make_directory_async(GLib.PRIORITY_DEFAULT, null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }
    _isRuntimeDirMade = true;
}

function _deleteRuntimeFile(path) {
    _lastPublished.delete(path);
    _queueRuntimeFileOp(path, async () => {
        try {
            await Gio.File.new_for_path(path).delete_async(GLib.PRIORITY_DEFAULT, null);
        } catch { /* never written */ }
    });
}

function _queueRuntimeFileOp(path, op) {
    const previous = _runtimeFileQueues.get(path) ?? Promise.resolve();
    _runtimeFileQueues.set(path, previous.then(op));
}

export function orderedAppIds(settings) {
    const map = getAppConfigMap(settings);
    return Object.entries(map)
        .filter(([, conf]) => !conf.is_hidden)
        .map(([appId, conf]) => ({appId, priority: conf.priority || 0}))
        .sort(byPriorityThenAppId)
        .map(entry => entry.appId);
}

// One settings write for the whole order. Per-icon writes would emit a changed
// signal each, and every signal fans out to all listeners in both processes.
export function setAppPriorities(settings, appIdsInOrder) {
    const listed = appIdsInOrder.filter(Boolean);
    const ordered = listed.filter((appId, i) => listed.lastIndexOf(appId) === i);
    if (ordered.length === 0)
        return;

    const map = getAppConfigMap(settings);
    const moving = new Set(ordered);

    // Callers pass only the icons they can see, so the stored order is rebuilt
    // whole and the listed ids are dealt back into the slots they held. Entries
    // without a priority stay out, they already sort below the numbered range.
    const slots = Object.keys(map)
        .filter(appId => !moving.has(appId) && map[appId].priority > 0)
        .concat(ordered)
        .map(appId => ({appId, priority: map[appId]?.priority || 0}))
        .sort(byPriorityThenAppId);

    let next = 0;
    for (const slot of slots) {
        if (moving.has(slot.appId))
            slot.appId = ordered[next++];
    }

    let changed = false;
    let priority = slots.length * PRIORITY_STEP;
    for (const {appId} of slots) {
        const entry = map[appId] ?? (map[appId] = {});
        if (entry.priority !== priority) {
            entry.priority = priority;
            changed = true;
        }
        priority -= PRIORITY_STEP;
    }

    if (changed)
        _saveMap(settings, map);
}

export function deleteAppConfig(settings, appId) {
    if (!appId)
        return;
    _sessionSeen.delete(appId);
    const map = getAppConfigMap(settings);
    if (map[appId]) {
        delete map[appId];
        _saveMap(settings, map);
        deleteCachedIcon(appId);
    }
}

export function resetAllAppConfigs(settings) {
    const keep = new Set([...RUNTIME_APP_CONFIG_FIELDS, 'priority']);
    const map = getAppConfigMap(settings);
    let changed = false;

    for (const appId of Object.keys(map)) {
        const entry = map[appId];
        const trimmed = {};
        for (const key of Object.keys(entry)) {
            if (keep.has(key))
                trimmed[key] = entry[key];
        }
        if (Object.keys(trimmed).length !== Object.keys(entry).length) {
            map[appId] = trimmed;
            changed = true;
        }
    }

    if (changed)
        _saveMap(settings, map);
}

const _migratedLegacy = new Map();

// One app's legacy key can be another app's current key, and carrying that
// entry away would leave its rightful owner at defaults.
const _claimedAppIds = new Set();

// Migration is a one-shot. Without this, forgetting an app and letting it
// re-register would hand it back the very entry the user just deleted.
const _migratedTargets = new Set();

export function claimAppId(appId) {
    if (appId)
        _claimedAppIds.add(appId);
}

export function releaseAppId(appId) {
    _claimedAppIds.delete(appId);
}

// Keys like 'main' or 'explorer' were shared by apps that should never have
// shared config. The first claimant takes the entry, later ones copy it, and a
// copy leaves the source because the old key may still be somebody's current one.
export function migrateLegacyConfig(settings, legacyId, appId, {copy = false} = {}) {
    if (!legacyId || !appId || legacyId === appId)
        return;
    if (_migratedTargets.has(appId))
        return;
    if (!copy && _claimedAppIds.has(legacyId))
        return;

    const map = getAppConfigMap(settings);
    if (map[appId])
        return;

    const legacy = map[legacyId] ?? _migratedLegacy.get(legacyId);
    if (!legacy)
        return;
    // The session guard is not enough for a copy, the source entry stays and a
    // later session would migrate it again. The stamp on the source is what
    // keeps that from resurrecting a target the user has forgotten since.
    if (copy && legacy.migrated_to?.includes(appId))
        return;

    _migratedTargets.add(appId);
    _migratedLegacy.set(legacyId, legacy);
    const carried = {...legacy};
    delete carried.cached_icon_path;
    delete carried.migrated_to;

    map[appId] = carried;
    if (!copy) {
        delete map[legacyId];
        deleteCachedIcon(legacyId);
    } else if (map[legacyId]) {
        map[legacyId] = {...legacy, migrated_to: [...legacy.migrated_to ?? [], appId]};
    }
    _saveMap(settings, map);
    if (!copy)
        _dropTombstone(settings, legacyId);
}

// After a Forget the app comes back through whichever writer touches it next,
// and setAppPriorities can recreate it holding a priority and nothing else.
// Every seed carries a title, so an entry without one is that ghost.
export function reseedIfForgotten(settings, appId, seed) {
    if (!appId || !seed || getAppConfigMap(settings)[appId]?.title)
        return;
    updateAppConfig(settings, appId, seed);
}

export function updateAppConfig(settings, appId, detectedData) {
    if (!appId)
        return;

    const map = getAppConfigMap(settings);
    const existing = map[appId] || {};

    const merged = {};
    for (const [k, v] of Object.entries(detectedData)) {
        if (v !== null && v !== undefined && v !== '' && v !== false)
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

    map[appId] = {...existing, ...merged};

    _saveMap(settings, map);
}

export function clearSeenCache() {
    _sessionSeen.clear();
    _migratedLegacy.clear();
    _claimedAppIds.clear();
    _migratedTargets.clear();
}
