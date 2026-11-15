import {group, styleGroups} from '../components/group.js';
import {CHEVRON, gearButton} from '../components/icon.js';
import {preview} from '../components/preview.js';
import {expanderRow} from '../components/expander.js';
import {rangeRow, row, segmentGroup} from '../components/row.js';
import {iconSubtitle} from '../components/emoji.js';
import {_} from '../shared/i18n.js';
import {ICON_SIZE_MAX_PX, state, toggleKey} from '../shared/store.js';
import {toggleIconMarkup} from '../shared/toggleIcon.js';
import {escapeHtml} from '../shared/util.js';

const TOGGLE_SIZE_MIN_PX = 8;

export function togglePage() {
    const isDrawer = state.displayMode === 'drawer';
    const [closedTitle, openTitle] = isDrawer ? [_('Drawer Closed'), _('Drawer Open')] : [_('Menu Closed'), _('Menu Open')];
    const stateRows = iconStateRow(closedTitle, toggleKey('toggleIcon')) + (state[toggleKey('rotate')] ? '' : iconStateRow(openTitle, toggleKey('toggleIconOpen')));
    const iconExpander = expanderRow('toggle-icon', _('Icon'), isDrawer ? _('One icon per drawer state.') : _('One icon per overflow menu state.'), {
        suffix: gearButton(_('Configure'), 'data-dialog="toggle-icon"'),
        rows: stateRows,
    });
    const hasPanelIcons = state.visible > 0;
    const sideSubtitle = hasPanelIcons ? _('Relative to the tray icons.') : _('No icons stay in the panel, so there is no side to pick.');
    const side = row(_('Side'), sideSubtitle, segmentGroup(_('Side'), 'toggleSide', [['left', _('Left')], ['right', _('Right')]], {isDisabled: !hasPanelIcons}));
    return preview('toggle') + group(_('Icon'), iconExpander + rangeRow(_('Size (px)'), 'toggleSize', TOGGLE_SIZE_MIN_PX, ICON_SIZE_MAX_PX)) + group(_('Position'), side) + styleGroups('toggle');
}

function iconStateRow(title, key) {
    return row(title, escapeHtml(iconSubtitle(state[key])), toggleIconMarkup(state[key], 'pref-state-icon') + CHEVRON, '', `role="button" tabindex="0" data-native-icon-picker="state:${key}"`);
}
