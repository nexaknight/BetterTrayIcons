import {cardGroup, choiceCard} from '../components/card.js';
import {group} from '../components/group.js';
import {spin, subRow} from '../components/row.js';
import {PANEL_BOXES, panelScene} from '../scenes/panelScene.js';
import {quickSettingsScene} from '../scenes/quickSettingsScene.js';
import {_} from '../shared/i18n.js';
import {isPanelMode, state, ui} from '../shared/store.js';

// MAX_PANEL_ORDER and MAX_VISIBLE in landing/demoState.js
const PANEL_ORDER_MAX = 20;
const VISIBLE_ICONS_MAX = 20;
const QS_VISIBLE_ROWS_MIN = 1;
const QS_VISIBLE_ROWS_MAX = 50;

export function appearancePage() {
    const mode = state.displayMode;
    const elements = subRow(_('Tray Icons'), _('Size, padding, colors'), 'icons', 'grid') +
        (isPanelMode() ? subRow(_('Toggle Button'), _('Icon, position, colors'), 'toggle', 'properties') : '') +
        (mode === 'popup' ? subRow(_('Overflow Menu'), _('Background, radius, spacing'), 'overflow', 'other') : '');
    return (isPanelMode() ? panelPlacementGroups(mode) : quickSettingsPlacementGroups()) + group(_('Elements'), elements);
}

function panelPlacementGroups(mode) {
    const cards = PANEL_BOXES.map(({box, label}) =>
        choiceCard({key: 'panelPosition', value: box, label: _(label), scene: panelScene(box, mode)})
    ).join('');
    const visibleSubtitle = mode === 'drawer'
        ? _('How many icons stay in the panel. The rest go to the drawer, at 0 every icon does.')
        : _('How many icons stay in the panel. The rest go to the overflow menu, at 0 every icon does.');
    // The landing panel is too narrow on a phone, every icon moves out there
    const lockedSubtitle = mode === 'drawer' ? _('Too narrow, all icons go to the drawer.') : _('Too narrow, all icons go to the popup.');
    const rows = spin(_('Position in Box'), 'panelOrder', 0, PANEL_ORDER_MAX, _('Order within the chosen box.')) +
        spin(_('Visible Icons'), 'visible', 0, VISIBLE_ICONS_MAX, ui.isPanelNarrow ? lockedSubtitle : visibleSubtitle, {isLocked: ui.isPanelNarrow});
    return cardGroup(_('Placement'), '', cards) + group('', rows);
}

function quickSettingsPlacementGroups() {
    const cards = choiceCard({key: 'qsMenuStyle', value: 'popup', label: _('Side Popup'), scene: quickSettingsScene('popup')}) +
        choiceCard({key: 'qsMenuStyle', value: 'inline', label: _('Inline'), scene: quickSettingsScene('inline')});
    const description = _('A side popup opens the menu next to Quick Settings. Inline unfolds it inside the list, right below the item.');
    const rows = spin(_('Visible Icons'), 'qsVisibleRows', QS_VISIBLE_ROWS_MIN, QS_VISIBLE_ROWS_MAX, _('How many tray items the Background Apps list shows before it scrolls.'));
    return cardGroup(_('Placement'), description, cards) + group('', rows);
}
