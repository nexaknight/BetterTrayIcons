import {cardGroup, choiceCard} from '../components/card.js';
import {group, styleGroups} from '../components/group.js';
import {preview, sampleIcons} from '../components/preview.js';
import {spin} from '../components/row.js';
import {_} from '../shared/i18n.js';
import {state} from '../shared/store.js';

const SCENE_ICON_COUNT = 4;
// MAX_GRID_COLUMNS in landing/demoState.js
const GRID_COLUMNS_MIN = 1;
const GRID_COLUMNS_MAX = 10;

export function overflowPage() {
    const cards = ['row', 'grid'].map(layout => choiceCard({
        key: 'layout',
        value: layout,
        label: layout === 'row' ? _('Row') : _('Grid'),
        scene: `<span class="pref-layout-scene"><span class="pref-preview-popup ${layout}">${sampleIcons(SCENE_ICON_COUNT)}</span></span>`,
        isBleed: false,
    })).join('');
    const columns = state.layout === 'grid' ? group('', spin(_('Grid Columns'), 'gridColumns', GRID_COLUMNS_MIN, GRID_COLUMNS_MAX)) : '';
    return preview('overflow') + cardGroup(_('Overflow Layout'), '', cards) + columns + styleGroups('overflow');
}
