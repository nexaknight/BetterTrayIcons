import {BLUETOOTH_ICON, GAUGE_ICON, MEDIA_DIR, VOLUME_MAX, WIFI_ICON, WIRED_ICON, hasSection, maskIcon, qsState, sectionMarkup, tileSubtitle} from './qsSections.js';
import {rangeSlider} from './range.js';
import {isDarkTheme, toggleTheme} from '../landing/theme.js';
import {repoIconUrl} from '../shared/iconValues.js';
import {setDoNotDisturb, ui} from '../shared/store.js';
import {clamp, escapeHtml} from '../shared/util.js';
import {_} from '../shared/i18n.js';
import {buttonMarkup} from './button.js';

const DARK_STYLE = 'dark-style';
const DO_NOT_DISTURB = 'dnd';
const CAFFEINE_URL = 'https://extensions.gnome.org/extension/517/caffeine/';
const VOLUME_ICONS = ['muted', 'low', 'medium', 'high'].map(level => `${MEDIA_DIR}/audio-volume-${level}-symbolic.svg`);
const VOLUME_STEPS = VOLUME_ICONS.length - 1;
const GRID_COLUMNS = 2;

const SYSTEM_BUTTONS = [
    [_('Take Screenshot'), repoIconUrl('sample-camera'), ''],
    [_('Settings'), `${MEDIA_DIR}/lucide-cog.svg`, ''],
    [_('Lock'), `${MEDIA_DIR}/lucide-lock.svg`, 'qs-end'],
    [_('Power Off'), `${MEDIA_DIR}/system-shutdown-symbolic.svg`, ''],
];

// Stand-in states, only Dark Style and Do Not Disturb are wired to the page
const TILES = [
    {id: 'wired', title: _('Wired'), subtitle: _('Connected'), icon: WIRED_ICON},
    {id: 'wifi', title: _('Wi-Fi'), subtitle: '', icon: WIFI_ICON},
    {id: 'bluetooth', title: 'Bluetooth', subtitle: '', icon: BLUETOOTH_ICON},
    {id: 'power-mode', title: _('Power Mode'), subtitle: '', icon: GAUGE_ICON},
    {id: 'night-light', title: _('Night Light'), subtitle: '', icon: `${MEDIA_DIR}/lucide-sun-moon.svg`},
    {id: DARK_STYLE, title: _('Dark Style'), subtitle: '', icon: repoIconUrl('lightbulb')},
    {id: DO_NOT_DISTURB, title: _('Do Not Disturb'), subtitle: '', icon: repoIconUrl('hidden')},
];
const CAFFEINE = {title: 'Caffeine', icon: `${MEDIA_DIR}/lucide-coffee.svg`};

const WIRED_TILES = {
    [DARK_STYLE]: {isOn: isDarkTheme, toggle: toggleTheme},
    [DO_NOT_DISTURB]: {isOn: () => ui.isDoNotDisturb, toggle: () => setDoNotDisturb(!ui.isDoNotDisturb)},
};

export function systemRow() {
    const buttons = SYSTEM_BUTTONS.map(([label, path, className]) =>
        buttonMarkup({variant: `qs-round ${className}`, leading: maskIcon(path), label})
    ).join('');
    return `<div class="qs-system">${buttons}</div>`;
}

// The icon left of the slider is GNOME's mute toggle
export function volumeRow() {
    return `<div class="qs-slider-row">${buttonMarkup({variant: 'qs-volume-icon', leading: maskIcon(volumeIconPath(), 'data-volume-icon'), label: _('Mute'), attributes: `aria-pressed="${qsState.isMuted}" data-qs-mute`})}` +
        `${rangeSlider(_('Volume'), 0, VOLUME_MAX, qsState.volume, 'data-qs-volume')}</div>`;
}

export function toggleMute() {
    if (qsState.isMuted) {
        qsState.volume = qsState.unmutedVolume;
    } else {
        qsState.unmutedVolume = qsState.volume || qsState.unmutedVolume;
        qsState.volume = 0;
    }
    qsState.isMuted = !qsState.isMuted;
}

// Moving the slider while muted unmutes at the new level
export function setVolume(value) {
    qsState.volume = value;
    qsState.isMuted = false;
}

// getIcon in gnome-shell js/ui/status/volume.js, three equal steps above muted
function volumeIconPath() {
    const {volume, isMuted} = qsState;
    if (isMuted || volume <= 0)
        return VOLUME_ICONS[0];
    return VOLUME_ICONS[clamp(Math.ceil(VOLUME_STEPS * volume / VOLUME_MAX), 1, VOLUME_STEPS)];
}

export function syncVolumeIcons() {
    for (const iconElement of document.querySelectorAll('#desktop [data-volume-icon]'))
        iconElement.style.setProperty('--bti', `url(${volumeIconPath()})`);
}

// An open menu takes the full width right below its tile's row and pushes
// the rows below down, as GNOME's quick settings grid does
export function gridMarkup() {
    const cells = [...TILES.map(tileMarkup), caffeineTile()];
    const openIndex = TILES.findIndex(tile => tile.id === qsState.openSection);
    if (openIndex >= 0)
        cells.splice((Math.floor(openIndex / GRID_COLUMNS) + 1) * GRID_COLUMNS, 0, sectionMarkup(qsState.openSection));
    return cells.join('');
}

function tileMarkup(tile) {
    const isOn = isTileOn(tile);
    const subtitleText = tileSubtitle(tile.id, tile.subtitle);
    const content = {leading: maskIcon(tile.icon), title: tile.title, subtitle: escapeHtml(subtitleText), textClass: 'qs-tile-text', attributes: `aria-pressed="${isOn}" data-qs-tile="${tile.id}"`};
    if (!hasSection(tile.id))
        return buttonMarkup({variant: 'qs-tile', ...content});
    const isOpen = qsState.openSection === tile.id;
    return `<div class="qs-tile has-menu ${isOn ? 'on' : ''}">${buttonMarkup({variant: 'qs-tile-main', ...content})}` +
        `${buttonMarkup({variant: 'qs-tile-arrow', leading: maskIcon(repoIconUrl('next')), label: _('%1 menu').replace('%1', tile.title), attributes: `aria-expanded="${isOpen}" data-qs-arrow="${tile.id}"`})}</div>`;
}

function isTileOn(tile) {
    return WIRED_TILES[tile.id]?.isOn() ?? qsState.tiles[tile.id];
}

// An easter egg, the tile links to the extension that keeps the screen awake
function caffeineTile() {
    return `<a class="qs-tile" href="${CAFFEINE_URL}" target="_blank" rel="noopener">` +
        `${maskIcon(CAFFEINE.icon)}<span class="qs-tile-text"><strong>${CAFFEINE.title}</strong></span></a>`;
}

export function flipTile(id) {
    const wired = WIRED_TILES[id];
    if (wired)
        wired.toggle();
    else
        qsState.tiles[id] = !qsState.tiles[id];
}

