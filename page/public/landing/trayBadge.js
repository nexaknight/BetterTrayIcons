import {APP_FIELD_DEFAULTS, BADGE_MAX_SIZE_PX, state} from '../shared/store.js';
import {escapeHtml} from '../shared/util.js';

// setBadgeContent in src/shell/icons/iconContent.js. The demo apps send no
// LauncherEntry counts or state changes, so an app with a sample unread
// count shows it and every other app shows the state-change dot.
const BADGE_DOT_ICON_RATIO = 0.3;
const BADGE_DOT_MIN_PX = 6;
const BADGE_TEXT_ICON_RATIO = 0.4;
const BADGE_TEXT_MIN_PX = 8;
const BADGE_TEXT_MIN_WIDTH_RATIO = 0.8;
const BADGE_TEXT_PADDING_X_PX = 3;
const ACCENT = 'var(--accent)';

export function badgeMarkup(app, iconSize) {
    const config = state.appConfigs[app.id];
    if (!config?.unreadBadge)
        return '';
    const position = config.badgePosition ?? APP_FIELD_DEFAULTS.badgePosition;
    const background = config.badgeColorAccent ? ACCENT : config.badgeColor ?? APP_FIELD_DEFAULTS.badgeColor;
    // The dialog's top radius means unset, a full circle
    const radius = config.badgeRadius < BADGE_MAX_SIZE_PX / 2 ? config.badgeRadius : null;
    const size = config.badgeSize > 0 ? config.badgeSize : null;
    if (!app.unread) {
        const dot = size ?? Math.max(BADGE_DOT_MIN_PX, Math.round(iconSize * BADGE_DOT_ICON_RATIO));
        const dotRadius = Math.min(radius ?? dot, Math.ceil(dot / 2));
        return `<span class="tray-badge ${position}" style="background:${escapeHtml(background)};width:${dot}px;height:${dot}px;border-radius:${dotRadius}px" aria-hidden="true"></span>`;
    }
    const font = size ?? Math.max(BADGE_TEXT_MIN_PX, Math.round(iconSize * BADGE_TEXT_ICON_RATIO));
    const color = config.badgeTextColorAccent ? ACCENT : config.badgeTextColor ?? APP_FIELD_DEFAULTS.badgeTextColor;
    return `<span class="tray-badge ${position}" style="background:${escapeHtml(background)};color:${escapeHtml(color)};font-size:${font}px;` +
        `padding:0 ${BADGE_TEXT_PADDING_X_PX}px;border-radius:${radius ?? font}px;min-width:${Math.ceil(font * BADGE_TEXT_MIN_WIDTH_RATIO)}px" aria-hidden="true">${app.unread}</span>`;
}
