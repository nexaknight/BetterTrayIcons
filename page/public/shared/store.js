import {bindSnapshot, readSnapshot} from './persist.js';
import {STYLE_DEFAULTS} from './styleDefaults.js';

const PANEL_MODES = ['popup', 'drawer'];
const DND_STORAGE_KEY = 'bti-site-dnd';
const RECENT_EMOJIS_KEY = 'bti-site-recent-emojis';
// RECENT_EMOJIS_MAX in src/prefs/components/iconEmojiPicker.js, two rows of 14
const RECENT_EMOJIS_MAX = 28;
export const TOGGLE_ICON_KEYS = ['toggleIcon', 'toggleIconOpen', 'rotate', 'rotateAngle', 'rotateReverse', 'animateRotation', 'rotateDuration', 'rotateDelay'];

// ICON_SIZE_RANGE_PX.max in src/const.js caps tray and toggle icons alike
export const ICON_SIZE_MAX_PX = 40;

// The tray-action-* and toggle-action-* defaults of the GSettings schema
export const DEFAULT_ACTIONS = {
    trayLeft: 'Activate',
    trayLeftDouble: 'None',
    trayLeftLong: 'Reorder (drag & drop)',
    trayMiddle: 'None',
    trayMiddleDouble: 'None',
    trayMiddleLong: 'None',
    trayRight: 'Open Menu',
    trayRightDouble: 'None',
    trayRightLong: 'None',
    trayTouchTap: 'Activate',
    trayTouchDouble: 'None',
    trayTouchLong: 'Open Menu',
    trayScroll: 'None',
    toggleLeft: 'Toggle Menu',
    toggleLeftDouble: 'None',
    toggleLeftLong: 'None',
    toggleMiddle: 'None',
    toggleMiddleDouble: 'None',
    toggleMiddleLong: 'None',
    toggleRight: 'Action Menu',
    toggleRightDouble: 'None',
    toggleRightLong: 'None',
    toggleTouchTap: 'Toggle Menu',
    toggleTouchDouble: 'None',
    toggleTouchLong: 'Action Menu',
    toggleScroll: 'None',
    menuHover: 'Overflow Popup',
};

export const DEMO_KEYS = ['toggleSide', 'panelPosition', 'visible', 'layout', 'gridColumns', 'symbolic', 'panelOrder'];

// Per-app fields the dialogs edit through state keys like appHidden-<id>.
// The badge fields mirror unread_badge and badge_style of the app-configs blob.
export const APP_FIELDS = {
    hidden: 'appHidden',
    whenInFront: 'appWhenInFront',
    scroll: 'appScroll',
    unreadBadge: 'appBadge',
    badgePosition: 'appBadgePosition',
    badgeRadius: 'appBadgeRadius',
    badgeSize: 'appBadgeSize',
    badgeColor: 'appBadgeColor',
    badgeTextColor: 'appBadgeTextColor',
    badgeColorAccent: 'appBadgeColorAccent',
    badgeTextColorAccent: 'appBadgeTextColorAccent',
};
// BADGE_POSITIONS, BADGE_DEFAULT_COLOR and BADGE_DEFAULT_TEXT_COLOR in
// src/const.js. An unset radius draws a full circle, an unset size is automatic.
export const BADGE_MAX_SIZE_PX = 48;
export const APP_FIELD_DEFAULTS = {
    unreadBadge: false,
    badgePosition: 'bottom-right',
    badgeRadius: BADGE_MAX_SIZE_PX / 2,
    badgeSize: 0,
    badgeColor: '#e01b24',
    badgeTextColor: '#ffffff',
    badgeColorAccent: false,
    badgeTextColorAccent: false,
};
export const APP_FIELD_NAMES = Object.fromEntries(Object.entries(APP_FIELDS).map(([field, key]) => [key, field]));
export const APP_FIELD_KEY = new RegExp(`^(${Object.values(APP_FIELDS).join('|')})-(.+)$`);

const RESET_DEFAULTS = {
    panelOrder: 0,
    visible: 2,
    toggleSide: 'left',
    panelPosition: 'right',
    layout: 'grid',
    gridColumns: 4,
    symbolic: false,
};

// The landing demo owns its keys, prefs.js copies them in at start
export const state = {
    ...RESET_DEFAULTS,
    displayMode: 'popup',
    wine: true,
    keepOpen: false,
    failedClick: true,
    drawerRemember: false,
    hideBackground: false,
    backgroundProxy: false,
    tooltips: true,
    whenInFront: 'none',
    tooltipPosition: 'top',
    tooltipDelay: 500,
    qsMenuStyle: 'popup',
    qsVisibleRows: 5,
    iconSize: 20,
    toggleSize: 20,
    ...STYLE_DEFAULTS,
    // toggle-icon-* and drawer-toggle-icon-* of the GSettings schema, the
    // drawer set reads through toggleKey()
    toggleIcon: 'view-more-symbolic',
    toggleIconOpen: 'view-more-symbolic',
    rotate: false,
    rotateAngle: '90',
    rotateReverse: false,
    animateRotation: true,
    rotateDuration: 200,
    rotateDelay: 0,
    drawerToggleIcon: 'bti-previous-symbolic',
    drawerToggleIconOpen: 'bti-previous-symbolic',
    drawerRotate: true,
    drawerRotateAngle: '180',
    drawerRotateReverse: false,
    drawerAnimateRotation: false,
    drawerRotateDuration: 150,
    drawerRotateDelay: 0,
    previewShowPadding: false,
    previewShowMargin: false,
    backups: 5,
    autoSync: false,
    syncPath: '',
    showBadges: true,
    showFilter: false,
    appConfigs: {},
    ...DEFAULT_ACTIONS,
};

export const ui = {
    page: 'appearance',
    subpage: null,
    dialogType: null,
    alert: null,
    picker: null,
    dropdownPopover: null,
    dropdownTrigger: null,
    isCollapsed: false,
    isSidebarShown: false,
    isDoNotDisturb: readFlag(DND_STORAGE_KEY),
    isPanelNarrow: false,
    recentEmojis: readList(RECENT_EMOJIS_KEY),
};

export const DEFAULT_STATE = structuredClone(state);

// The GSettings getters src/shell/trayStyle.js reads, over the page's state
export const settings = {
    get_boolean: key => Boolean(state[key]),
    get_int: key => Number(state[key]),
    get_string: key => String(state[key]),
    settings_schema: {has_key: key => key in DEFAULT_STATE},
};

// Per-app config is an object the defaults leave out
const STORED_OBJECT_KEYS = ['appConfigs'];
const stored = readSnapshot();
hydrate(stored);

// Stored values only fill keys the defaults know, with the same type, so an
// edited or stale entry can't break the page
function hydrate(snapshot) {
    if (!snapshot)
        return;
    for (const [key, value] of Object.entries(snapshot.state ?? {})) {
        const isKnown = key in DEFAULT_STATE && typeof value === typeof DEFAULT_STATE[key];
        const isObject = STORED_OBJECT_KEYS.includes(key) && value && typeof value === 'object';
        if (isKnown || isObject)
            state[key] = value;
    }
    if (typeof snapshot.page === 'string')
        ui.page = snapshot.page;
    if (typeof snapshot.subpage === 'string')
        ui.subpage = snapshot.subpage;
}

// The tray order and the drawer as stored, apps.js and app.js apply them
export const storedOrder = Array.isArray(stored?.order) ? stored.order : [];
export const isStoredDrawerOpen = stored?.drawerOpen === true;
export const storedQuickSettings = stored?.quickSettings ?? null;
export const storedExpanders = Array.isArray(stored?.expanders) ? stored.expanders.filter(id => typeof id === 'string') : [];

/**
 * Connects the store to its storage, the caller knows the tray order and the
 * drawer, the store knows the rest.
 *
 * @param {Function} extras Returns the order, whether the drawer is open,
 * the Quick Settings and the open expanders.
 */
export function bindPersistence(extras) {
    bindSnapshot(() => {
        const {order, isDrawerOpen, quickSettings, expanders} = extras();
        const persisted = Object.fromEntries(Object.keys(DEFAULT_STATE).concat(STORED_OBJECT_KEYS)
            .filter(key => key in state).map(key => [key, state[key]]));
        // The drawer comes back open only where the real one remembers it
        const drawerOpen = state.drawerRemember && state.displayMode === 'drawer' && isDrawerOpen;
        return {state: persisted, page: ui.page, subpage: ui.subpage, order, drawerOpen, quickSettings, expanders};
    });
}

// toggleIconKey in src/shared/toggleIconKeys.js, the drawer keeps its own set
export function toggleKey(key) {
    return state.displayMode === 'drawer' ? drawerKey(key) : key;
}

export function drawerKey(key) {
    return `drawer${key[0].toUpperCase()}${key.slice(1)}`;
}

export function isPanelMode() {
    return PANEL_MODES.includes(state.displayMode);
}

// Do Not Disturb in the recreated Quick Settings silences every toast and,
// like the site theme, outlives the visit
export function setDoNotDisturb(isOn) {
    ui.isDoNotDisturb = isOn;
    try {
        localStorage.setItem(DND_STORAGE_KEY, String(isOn));
    } catch {
        // Blocked storage only loses the choice for the next visit
    }
}

// Recent emojis outlive the visit like the theme does
export function rememberEmoji(hex) {
    ui.recentEmojis = [hex, ...ui.recentEmojis.filter(entry => entry !== hex)].slice(0, RECENT_EMOJIS_MAX);
    try {
        localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(ui.recentEmojis));
    } catch {
        // Blocked storage only loses the list for the next visit
    }
}

function readList(key) {
    try {
        const list = JSON.parse(localStorage.getItem(key) ?? '[]');
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function readFlag(key) {
    try {
        return localStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
}
