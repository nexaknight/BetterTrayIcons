import {group, styleGroups} from '../components/group.js';
import {preview} from '../components/preview.js';
import {rangeRow, switchRow} from '../components/row.js';
import {_} from '../shared/i18n.js';
import {ICON_SIZE_MAX_PX} from '../shared/store.js';

const ICON_SIZE_MIN_PX = 0;

export function iconsPage() {
    const icons = switchRow(_('Symbolic Icons'), 'symbolic', _('Use monochrome icons when available.')) + rangeRow(_('Icon Size (px)'), 'iconSize', ICON_SIZE_MIN_PX, ICON_SIZE_MAX_PX);
    return preview('icons') + group(_('Icons'), icons) + styleGroups('icons');
}
