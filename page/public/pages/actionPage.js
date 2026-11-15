import {group} from '../components/group.js';
import {gearButton} from '../components/icon.js';
import {openDropdown} from '../components/popover.js';
import {row, selectRow} from '../components/row.js';
import {overlay, root, scroll} from '../components/window.js';
import {_} from '../shared/i18n.js';
import {isPanelMode, state, ui} from '../shared/store.js';
import {views} from '../shared/views.js';

const SHORTCUT_HIGHLIGHT_MS = 2500;
const SHORTCUT_SCROLL_MARGIN_PX = 20;

const SCROLL_HELP = _('Forward to the App sends your mouse wheel to the app behind the icon. Apps that support it react, for example by switching devices or changing the volume. Most apps take the wheel and do nothing with it.\n\n' +
    'In Background Apps mode the wheel then no longer scrolls the Quick Settings list while the pointer is over such an icon, because the event goes to the app. To keep the list scrolling, set this to None and pick Forward only for the apps that use it, in their own settings under Applications.');

export const TRAY_OPTIONS = ['Activate', 'Open Menu', 'None'];
export const TRAY_LONG_OPTIONS = ['Activate', 'Open Menu', 'Reorder (drag & drop)', 'None'];
export const TOGGLE_OPTIONS = ['Toggle Menu', 'Cycle Icons', 'Action Menu', 'Open BTI Settings', 'None'];
export const CLICK_TITLES = {Left: _('Left Click'), Middle: _('Middle Click'), Right: _('Right Click')};
const SHORTCUT_SELECTS = {click: 'trayLeft', double: 'trayLeftDouble', long: 'trayLeftLong', touch: 'trayTouchTap', scroll: 'trayScroll'};
const SHORTCUT_DIALOGS = {double: 'action:trayLeft', long: 'action:trayLeft', touch: 'action:trayTouch'};

export function actionsPage() {
    const scrollHelp = state.displayMode === 'background-apps' ? SCROLL_HELP : '';
    const trayRows = clickRows('tray', TRAY_OPTIONS) + selectRow(_('Scroll'), 'trayScroll', ['Forward to the App', 'None'], '', {help: scrollHelp});
    const hoverRow = state.displayMode === 'popup'
        ? selectRow(_('Menu on Hover'), 'menuHover', ['Overflow Popup', 'Action Menu'], _('Which menu opens when you move onto the toggle button while another panel menu is open'), {isNaturalWidth: true})
        : '';
    const toggleRows = clickRows('toggle', TOGGLE_OPTIONS) +
        selectRow(_('Scroll'), 'toggleScroll', ['Cycle Icons', 'None'], _('Scroll direction picks which way the icons rotate'), {isNaturalWidth: true}) + hoverRow;
    const toggleGroup = isPanelMode() ? group(_('Toggle Button Clicks'), toggleRows, '', 'pref-actions') : '';
    return group(_('Tray Icon Clicks'), trayRows, '', 'pref-actions') + toggleGroup;
}

function clickRows(prefix, options) {
    const clicks = Object.entries(CLICK_TITLES).map(([name, title]) => selectRow(title, prefix + name, options, '', {hasGear: true})).join('');
    return clicks + row(_('Touch'), _('Tap, double tap and long touch.'), gearButton(_('Configure'), `data-action-gear="${prefix}Touch"`));
}

export function openActionShortcut(kind) {
    views.openPage('actions');
    if (SHORTCUT_DIALOGS[kind])
        views.openModal(SHORTCUT_DIALOGS[kind]);
    const target = root.querySelector(`[data-pref-select-trigger="${SHORTCUT_SELECTS[kind]}"]`);
    scrollIntoArea(target);
    // The list opens on its first option, so arrows and Escape work at once
    requestAnimationFrame(() => {
        if (target.isConnected)
            openDropdown(target, 'first');
    });
    const targetRow = target.closest('.pref-row');
    targetRow.classList.add('pref-shortcut-target');
    setTimeout(() => targetRow.classList.remove('pref-shortcut-target'), SHORTCUT_HIGHLIGHT_MS);
}

function scrollIntoArea(target) {
    const area = ui.dialogType ? overlay.querySelector('.pref-dialog-body') : scroll;
    const rect = target.getBoundingClientRect();
    const view = area.getBoundingClientRect();
    const scale = root.getBoundingClientRect().width / root.offsetWidth;
    const isOutside = rect.top < view.top || rect.bottom > view.bottom;
    if (isOutside)
        area.scrollTop += (rect.top - view.top) / scale - SHORTCUT_SCROLL_MARGIN_PX;
}
