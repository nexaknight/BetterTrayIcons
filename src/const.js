// ------- Logging -------

export const LOG_PREFIX = '[BetterTrayIcons] ';


// ------- External URLs -------

export const GIT_REPO_URL = 'https://github.com/nexaknight/BetterTrayIcons';
export const LICENSE_URL = 'https://github.com/nexaknight/BetterTrayIcons/blob/main/LICENSE';
export const SPONSOR_URL = 'https://github.com/sponsors/nexaknight';
export const TRANSLATE_URL = 'https://github.com/nexaknight/BetterTrayIcons/wiki/Translation-Guidelines';


// ------- Input timing (ms) -------

export const LONG_PRESS_TIMEOUT_MS = 600;
export const DOUBLE_CLICK_MAX_DELAY_MS = 250;


// ------- UI update timing (ms) -------

export const ICON_UPDATE_DELAY_MS = 20;
export const LAYOUT_UPDATE_DELAY_MS = 100;
// One Clutter relayout cycle after reparenting.
export const GEOMETRY_SETTLE_MS = 50;


// ------- Debounce intervals (ms) -------

// Typed entries in the prefs UI.
export const ENTRY_DEBOUNCE_MS = 300;
// Icon-picker page entry, slower to allow multi-digit input.
export const PAGE_JUMP_DEBOUNCE_MS = 500;
// Coalesce app-configs bursts into one Applications page rebuild.
export const PAGE_REBUILD_DEBOUNCE_MS = 100;
// Auto-sync filesystem writes, prevents reading mid-write.
export const AUTO_SYNC_DEBOUNCE_MS = 1000;
// Coalesce bursts of local settings changes before rewriting the file.
export const AUTO_PUSH_DEBOUNCE_MS = 2000;


// ------- Guard windows (ms) -------

// Wait for DBus name ownership before scanning existing services.
export const INITIAL_SCAN_DELAY_MS = 500;
// Suppress auto-push after a pull so import signals don't echo to disk.
export const AUTO_PUSH_GUARD_AFTER_IMPORT_MS = 3000;
// Reject reopening the same context menu within this window.
export const MENU_REOPEN_GUARD_MS = 200;


// ------- Layout / sizing (px) -------

export const ITEM_SPACING_PX = 6;
export const ICON_MARGIN_PX = 1;
// Minimum row height for the grid overflow layout.
export const OVERFLOW_GRID_MIN_ROW_HEIGHT_PX = 24;
// Pill-shape radius for non-custom tray icon buttons.
export const DEFAULT_PILL_RADIUS_PX = 50;


// ------- Drag-and-drop -------

export const DRAG_ACTOR_MAX_SIZE_PX = 48;
// Matches GTK's default drag threshold.
export const DND_DRAG_THRESHOLD_PX = 8;
// Floating drag preview opacity (0-255).
export const DRAG_ACTOR_OPACITY = 180;
// Source icon opacity while dragging (0-255).
export const DRAGGING_SOURCE_OPACITY = 60;
// Gaps of 10 leave room for manual reorder edits between drags.
export const PRIORITY_STEP = 10;
// Long-press settings that gate DnD, watched by every icon class.
export const DRAG_SETTING_KEYS = Object.freeze([
    'tray-action-left-long',
    'tray-action-middle-long',
    'tray-action-right-long',
]);


// ------- Tray icons -------

// Tray icons restyle only on these keys.
export const TRAY_STYLE_KEYS = Object.freeze([
    'enable-custom-icon-style',
    'icon-size',
    'icon-padding-vertical',
    'icon-padding-horizontal',
    'icon-border-radius',
    'icon-color',
    'icon-hover-color',
    'icon-background-color',
    'icon-hover-background-color',
]);

// Config entry fields a tray icon renders from. Lets an icon skip the
// refetch when an app-configs write didn't touch any of them.
export const TRAY_CONFIG_RENDER_FIELDS = Object.freeze([
    'is_hidden',
    'custom_title',
    'custom_icon',
    'cached_icon_path',
    'detected_icon',
    'icon_theme_path',
]);


// ------- XEmbed tray -------

// XEmbed wrappers re-render only on these keys.
export const XEMBED_STYLE_KEYS = Object.freeze([
    'enable-custom-icon-style',
    'icon-padding-vertical',
    'icon-padding-horizontal',
    'icon-border-radius',
    'icon-background-color',
    'icon-hover-background-color',
]);
// Fallback when no custom overflow background is set, roughly matches the
// shell panel background.
export const XEMBED_BG_FALLBACK_HEX = '#36363A';


// ------- Icon cache -------

// XDG cache subdir under $XDG_CACHE_HOME for pixmap PNGs.
export const ICON_CACHE_SUBDIR = 'bettertrayicons/icons';


// ------- Process detection (Wine / Proton) -------

// /proc/<pid>/cmdline basenames indicating a Wine launcher.
export const WINE_LAUNCHER_BINARIES = new Set([
    'wine', 'wine64',
    'wine-preloader', 'wine64-preloader',
    'wineserver', 'wineboot', 'winemenubuilder.exe',
]);


// ------- Geometry helpers -------

// CSS shorthand order for reading 4-sided settings into {top, right, bottom, left}.
export const BOX_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);


// ------- Applications page -------

// Wine and Proton icons render via XEmbed, so X11 surfaces can't be
// snapshotted portably. Use a Wine glyph. Most distros only ship the
// colored `wine` icon, hence the symbolic fallbacks.
export const WINE_ICON_NAMES = Object.freeze([
    'wine-symbolic',
    'wine',
    'application-x-ms-dos-executable-symbolic',
    'applications-other-symbolic',
]);

// Generic IDs from before identifyApp picked stable process names.
// The Applications page prunes leftovers matching these.
export const LEGACY_ID_PATTERNS = Object.freeze([
    /^chrome_status_icon_1$/,
    /^_\d+_/,
    /StatusNotifierItem/,
]);


// ------- Styling defaults -------

export const DEFAULT_HOVER_BG_COLOR = 'rgba(255,255,255,0.1)';
// Mirrors PopupAnimation.NONE. const.js is also loaded by the prefs
// process, which can't import the shell's ui modules.
export const POPUP_ANIMATION_NONE = 0;


// ------- DBus menu parsing -------

// Large menus would block the UI thread without periodic yields.
export const DBUS_MENU_YIELD_EVERY_N_ITEMS = 20;


// ------- Settings validation (sync import) -------

// Colors feed inline set_style() strings, filter against CSS injection.
export const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.,\s]+\s*\))$/i;

// Bracket-assigning these would pollute Object.prototype via a sync file.
export const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ------- Recommended toggle icons -------

export const RECOMMENDED_TOGGLE_ICONS = [
    'view-grid-symbolic',
    'view-app-grid-symbolic',
    'start-here-symbolic',
    'preferences-desktop-apps-symbolic',
    'pan-up-symbolic',
    'pan-end-symbolic',
    'pan-down-symbolic',
    'pan-start-symbolic',
    'go-up-symbolic',
    'go-next-symbolic',
    'go-down-symbolic',
    'go-previous-symbolic',
    'go-top-symbolic',
    'go-bottom-symbolic',
    'orientation-landscape-symbolic',
    'orientation-portrait-right-symbolic',
    'orientation-landscape-inverse-symbolic',
    'orientation-portrait-left-symbolic',
    'applications-other-symbolic',
    'application-menu-symbolic',
    'radio-symbolic',
    'radio-checked-symbolic',
    'software-update-available-symbolic',
    'emoji-symbols-symbolic',
    'weather-clear-symbolic',
    'media-playback-start-symbolic',
    'input-gaming-symbolic',
    'org.gnome.Settings-symbolic',
];

// ------- About page -------

// Contributor cards shown before a "Show more" card replaces the rest.
export const MAX_CONTRIBUTORS = 5;

// GitHub usernames (lowercase, no leading "@") excluded from the About page contributor strip.
// See CONTRIBUTING.md for the opt-out procedure.
export const CONTRIBUTORS_OPTOUT = new Set([
    'github-actions[bot]',
    'dependabot[bot]',
    'Agent19872',
]);
