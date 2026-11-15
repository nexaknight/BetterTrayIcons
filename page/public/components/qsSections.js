import {repoIconUrl} from '../shared/iconValues.js';
import {clamp, escapeHtml} from '../shared/util.js';
import {_} from '../shared/i18n.js';
import {buttonMarkup} from './button.js';

// The menus behind the arrows of GNOME's network, Bluetooth and power mode
// tiles, all sample data. A row only moves the check mark or the tile's
// subtitle, the settings button at the bottom does nothing.
export const MEDIA_DIR = 'media/page';
export const WIRED_ICON = `${MEDIA_DIR}/lucide-ethernet-port.svg`;
export const WIFI_ICON = `${MEDIA_DIR}/network-wireless-signal-excellent-symbolic.svg`;
export const BLUETOOTH_ICON = `${MEDIA_DIR}/lucide-bluetooth.svg`;
export const GAUGE_ICON = `${MEDIA_DIR}/lucide-gauge.svg`;

const WIFI_NETWORKS = ['Pinewood', 'Pinewood Guest', 'Pinewood IoT', 'Cafe Nordpol', 'Hinterhof 5G'];
export const VOLUME_MAX = 100;
const DEFAULT_VOLUME = 70;
const POWER_MODES = [['performance', _('Performance')], ['balanced', _('Balanced')], ['power-saver', _('Power Saver')]];

// What a reload keeps, Quick Settings itself still opens closed
export const qsState = {
    openSection: null,
    powerMode: 'balanced',
    wifi: WIFI_NETWORKS[0],
    volume: DEFAULT_VOLUME,
    isMuted: false,
    // The level the mute button brings back, as GNOME's volume slider keeps it
    unmutedVolume: DEFAULT_VOLUME,
    tiles: {'wired': true, 'wifi': true, 'bluetooth': false, 'power-mode': true, 'night-light': false},
};

const SECTIONS = {
    'wired': {
        title: _('Wired'),
        icon: WIRED_ICON,
        rows: () => [{icon: WIRED_ICON, label: _('Wired'), trailing: `<span class="qs-row-dim">${_('Disconnect')}</span>`}],
        settings: _('LAN Settings'),
    },
    'wifi': {
        title: _('Wi-Fi'),
        icon: WIFI_ICON,
        rows: () => WIFI_NETWORKS.map(name => ({icon: WIFI_ICON, isLocked: true, label: name, value: name, isChecked: name === qsState.wifi})),
        settings: _('All Networks'),
    },
    'bluetooth': {
        title: 'Bluetooth',
        icon: BLUETOOTH_ICON,
        rows: () => [{icon: repoIconUrl('sample-game'), label: 'DualSense Wireless Controller', trailing: maskIcon(repoIconUrl('unlink'))}],
        settings: _('Bluetooth Settings'),
    },
    'power-mode': {
        title: _('Power Mode'),
        icon: GAUGE_ICON,
        // The power mode menu shows a grey badge, it is no on/off switch
        isPlainBadge: true,
        rows: () => POWER_MODES.map(([value, label]) => ({icon: GAUGE_ICON, label, value, isChecked: value === qsState.powerMode})),
        settings: _('Power Settings'),
    },
};

export function restoreQuickSettings(stored) {
    if (!stored || typeof stored !== 'object')
        return;
    qsState.openSection = hasSection(stored.openSection) ? stored.openSection : null;
    if (POWER_MODES.some(([value]) => value === stored.powerMode))
        qsState.powerMode = stored.powerMode;
    if (WIFI_NETWORKS.includes(stored.wifi))
        qsState.wifi = stored.wifi;
    if (Number.isFinite(stored.volume))
        qsState.volume = clamp(stored.volume, 0, VOLUME_MAX);
    if (Number.isFinite(stored.unmutedVolume))
        qsState.unmutedVolume = clamp(stored.unmutedVolume, 1, VOLUME_MAX);
    if (typeof stored.isMuted === 'boolean')
        qsState.isMuted = stored.isMuted;
    for (const id of Object.keys(qsState.tiles)) {
        if (typeof stored.tiles?.[id] === 'boolean')
            qsState.tiles[id] = stored.tiles[id];
    }
}

export function hasSection(id) {
    return typeof id === 'string' && Object.hasOwn(SECTIONS, id);
}

export function tileSubtitle(id, fallback) {
    if (id === 'wifi')
        return qsState.tiles.wifi ? qsState.wifi : '';
    if (id === 'power-mode')
        return POWER_MODES.find(([value]) => value === qsState.powerMode)[1];
    return fallback;
}

export function sectionMarkup(id) {
    const section = SECTIONS[id];
    const isActive = !section.isPlainBadge && qsState.tiles[id];
    const rows = section.rows().map(row => rowMarkup(id, row)).join('');
    return `<div class="qs-section" data-qs-section="${id}"><div class="qs-section-card">${menuHeader(section.icon, section.title, isActive)}` +
        `<div class="qs-section-rows">${rows}</div><div class="qs-separator"></div>` +
        `${buttonMarkup({variant: 'qs-section-settings', title: escapeHtml(section.settings)})}</div></div>`;
}

function rowMarkup(sectionId, row) {
    const icon = row.isLocked
        ? `<span class="qs-row-icon locked">${maskIcon(row.icon)}${maskIcon(`${MEDIA_DIR}/lucide-lock.svg`, '', 'qs-row-lock')}</span>`
        : `<span class="qs-row-icon">${maskIcon(row.icon)}</span>`;
    const check = row.isChecked ? maskIcon(repoIconUrl('select'), '', 'qs-row-check') : '';
    const choose = row.value ? `data-qs-choose="${sectionId}" data-value="${escapeHtml(row.value)}"` : '';
    return buttonMarkup({variant: 'qs-section-row', leading: icon, title: `<span>${escapeHtml(row.label)}</span>`, trailing: check + (row.trailing ?? ''), attributes: choose});
}

export function menuHeader(iconPath, title, isActive = false) {
    return `<div class="qs-apps-header"><span class="qs-apps-header-icon ${isActive ? 'active' : ''}">${maskIcon(iconPath)}</span><strong>${escapeHtml(title)}</strong></div>`;
}

export function chooseRow(sectionId, value) {
    if (sectionId === 'wifi')
        qsState.wifi = value;
    else if (sectionId === 'power-mode')
        qsState.powerMode = value;
}

export function maskIcon(path, attributes = '', className = '') {
    return `<svg aria-hidden="true" class="bti ${className}" ${attributes} style="--bti:url(${path})"></svg>`;
}
