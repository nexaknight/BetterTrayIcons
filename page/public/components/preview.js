import {_} from '../shared/i18n.js';
import {icon, iconButton} from './icon.js';
import {editsLightSet} from '../../../src/shared/colorVariant.js';
import {isPanelMode, settings, state, toggleKey} from '../shared/store.js';
import {STYLE_KINDS} from '../shared/styleDefaults.js';
import {toggleIconMarkup, toggleIconState} from '../shared/toggleIcon.js';
import {groupHeading, groupSection} from './group.js';
import {GUIDE_KEYS} from './guide.js';
import {escapeHtml} from '../shared/util.js';
import {buttonMarkup} from './button.js';

const MAX_PREVIEW_COLUMNS = 8;
const PREVIEW_CELL_PX = 32;
const TOGGLE_SAMPLE_COUNT = 2;
const ICON_SAMPLE_COUNT = 4;
const SAMPLE_ICONS = ['chat', 'music', 'game', 'mail', 'camera', 'browser', 'vault', 'terminal'];

// A click on the sample opens and closes it, the icon swaps or turns as the
// panel's toggle does
export function spinPreviewToggle(button) {
    const isOpen = button.classList.toggle('open');
    const {value, angle, isAnimated, duration, delay} = toggleIconState(isOpen);
    if (button.dataset.icon !== value) {
        button.dataset.icon = value;
        button.innerHTML = toggleIconMarkup(value);
    }
    const iconElement = button.firstElementChild;
    iconElement.style.transition = isAnimated ? `transform ${duration}ms ease-out ${delay}ms` : 'none';
    iconElement.style.transform = angle ? `rotate(${angle}deg)` : '';
}

export function sampleIcons(count = SAMPLE_ICONS.length, attributes = '') {
    return SAMPLE_ICONS.slice(0, count).map(name => `<span ${attributes}>${icon(`sample-${name}`)}</span>`).join('');
}

// The guides measure only a custom style, so their toggles rest while it is
// off, as createPreviewGroup in src/prefs/components/preview.js binds them
export function preview(kind) {
    const {customKey, colorPrefix} = STYLE_KINDS[kind];
    const guide = (name, label) => {
        const isOn = state[GUIDE_KEYS[name]];
        return iconButton(name, label, `data-pref-switch="${GUIDE_KEYS[name]}" aria-pressed="${isOn}" ${state[customKey] ? '' : 'disabled'}`, isOn ? 'active' : '');
    };
    const hasGuides = kind !== 'icons' || isPanelMode();
    const guides = hasGuides ? guide('padding', _('Measure the padding while hovering the preview.')) + guide('margin', _('Measure the margin while hovering the preview.')) : '';
    // The stage turns light with the light set, so its colors show
    const isLight = state[customKey] && state[`${colorPrefix}-color-split`] && editsLightSet(settings);
    const sizes = `--preview-icon-px:${state.iconSize}px;--preview-toggle-px:${state.toggleSize}px`;
    const stage = `<div class="pref-preview-stage ${kind === 'overflow' ? 'popup' : ''} ${isLight ? 'light' : ''}" style="${sizes}" data-preview-kind="${kind}">${previewContent(kind)}` +
        '<svg class="pref-guides" aria-hidden="true"></svg></div>';
    return groupSection('', groupHeading(_('Preview'), guides) + stage);
}

function previewContent(kind) {
    if (kind === 'overflow') {
        const columns = Math.min(state.gridColumns, MAX_PREVIEW_COLUMNS);
        return `<span class="pref-preview-popup ${state.layout === 'row' ? 'row' : ''}" data-guide-target style="grid-template-columns:repeat(${columns},${PREVIEW_CELL_PX}px)">${sampleIcons()}</span>`;
    }
    if (kind === 'toggle') {
        const closedIcon = state[toggleKey('toggleIcon')];
        const toggle = buttonMarkup({variant: 'pref-preview-toggle', leading: toggleIconMarkup(closedIcon), label: 'Toggle preview icon', attributes: `data-toggle-native-preview data-guide-target data-icon="${escapeHtml(closedIcon)}"`});
        return state.toggleSide === 'left' ? toggle + sampleIcons(TOGGLE_SAMPLE_COUNT) : sampleIcons(TOGGLE_SAMPLE_COUNT) + toggle;
    }
    return sampleIcons(ICON_SAMPLE_COUNT, 'data-guide-target');
}
