import {group} from '../components/group.js';
import {accentSwitchRow, editedColorSwatch, negateButton, row, segmentGroup, segmented, selectRow, spin, switchRow} from '../components/row.js';
import {CLICK_TITLES, TOGGLE_OPTIONS, TRAY_LONG_OPTIONS, TRAY_OPTIONS} from '../pages/actionPage.js';
import {_} from '../shared/i18n.js';
import {usesAccent} from '../../../src/shared/accentColor.js';
import {editedColorKey} from '../../../src/shared/colorVariant.js';
import {settings, state, toggleKey} from '../shared/store.js';

const TOOLTIP_DELAY_MAX_MS = 5000;
const ROTATION_TIMING_MAX_MS = 2000;

export const KEEP_OPEN_TITLES = {'popup': _('Overflow Menu'), 'drawer': _('Drawer'), 'background-apps': _('Quick Settings')};

export function colorDialogTitle(key) {
    if (key.endsWith('-background-color'))
        return _('Background Color');
    return key.endsWith('-border-color') ? _('Border Color') : _('Icon Color');
}

export function tooltipsContent() {
    return group('', segmented(_('Position'), 'tooltipPosition', [['top', _('Top')], ['bottom', _('Bottom')]]) + spin(_('Delay (ms)'), 'tooltipDelay', 0, TOOLTIP_DELAY_MAX_MS));
}

export function backgroundContent() {
    return group('', switchRow(_('Create Tray Icons for Background Apps'), 'backgroundProxy', _('Adds a tray icon for windowless background apps that lack one of their own.')));
}

export function keepOpenContent() {
    return group('', switchRow(_('Stay Open When a Click Has No Effect'), 'failedClick', _('Some apps never answer a click.')));
}

export function toggleIconContent() {
    const rotateRow = switchRow(_('Rotate While Open'), toggleKey('rotate'), _('Turn the icon instead of swapping it for a second one.'));
    if (!state[toggleKey('rotate')])
        return group('', rotateRow);
    const reverse = {key: toggleKey('rotateReverse'), iconName: 'swap', label: _('Reverse the turning direction')};
    const timing = state[toggleKey('animateRotation')]
        ? spin(_('Duration (ms)'), toggleKey('rotateDuration'), 0, ROTATION_TIMING_MAX_MS) + spin(_('Delay (ms)'), toggleKey('rotateDelay'), 0, ROTATION_TIMING_MAX_MS)
        : '';
    const angles = segmentGroup(_('Angle'), toggleKey('rotateAngle'), [['90', '90°'], ['180', '180°'], ['270', '270°']],
        {labelPrefix: state[reverse.key] ? '-' : ''});
    return group('', rotateRow +
        row(_('Angle'), '', negateButton(reverse) + angles) +
        switchRow(_('Animate Rotation'), toggleKey('animateRotation'), _('Off turns the icon in one jump.')) + timing);
}

// createAccentColorRow, the overflow colors have no hover twin
export function colorContent(key) {
    const hoverKey = key.replace(/^(icon|toggle-icon)-/, '$1-hover-');
    const hasHover = hoverKey !== key;
    const hoverUsesAccent = hasHover && usesAccent(state[editedColorKey(settings, hoverKey)]);
    const hover = hasHover
        ? accentSwitchRow(_('Use Accent Color on Hover'), hoverKey) + (hoverUsesAccent ? '' : row(_('Hover'), '', editedColorSwatch(hoverKey, _('Hover'))))
        : '';
    return group(colorDialogTitle(key), accentSwitchRow(_('Use Accent Color'), key) + hover);
}

export function actionTitle(key) {
    if (key.endsWith('Touch'))
        return _('Touch');
    return CLICK_TITLES[key.replace(/^(tray|toggle)/, '')];
}

export function actionContent(key) {
    const isTray = key.startsWith('tray');
    const isTouch = key.endsWith('Touch');
    const options = isTray ? TRAY_OPTIONS : TOGGLE_OPTIONS;
    const tap = isTouch ? selectRow(_('Tap'), `${key}Tap`, options) : '';
    const double = selectRow(isTouch ? _('Double Tap') : _('Double Click'), `${key}Double`, options);
    const long = selectRow(isTouch ? _('Long Touch') : _('Long Press'), `${key}Long`, isTray ? TRAY_LONG_OPTIONS : TOGGLE_OPTIONS);
    return group(isTouch ? '' : _('Advanced'), tap + double + long);
}
