import {_} from '../shared/i18n.js';
import {applyClamp} from './clamp.js';
import {alertMarkup, dialogMarkup} from './dialog.js';
import {iconButton} from './icon.js';
import {closeDropdown} from './popover.js';
import {syncInert} from './sidebar.js';
import {hidePrefTooltip} from './tooltip.js';
import {overlay} from './window.js';
import {changelogContent, creditsDialog, linkDialog} from '../dialogs/aboutDialogs.js';
import {appContent} from '../dialogs/appDialog.js';
import {STATUS_DIALOG_WIDTH_PX, statusBadgeContent} from '../dialogs/statusBadgeDialog.js';
import {KEEP_OPEN_TITLES, actionContent, actionTitle, backgroundContent, colorContent, colorDialogTitle, keepOpenContent, toggleIconContent, tooltipsContent} from '../dialogs/configDialog.js';
import {syncContent} from '../dialogs/syncDialog.js';
import {appById, displayName} from '../shared/apps.js';
import {DIALOG_KEYS} from '../shared/settings.js';
import {state, ui} from '../shared/store.js';
import {holdPage, releasePage} from './modalScroll.js';

// The demo's dialogs share one hold on the page, they replace each other
const DEMO_MODAL = 'demo-modal';

// Widths mirror the pinDialogWidth callers under src/prefs/
const SYNC_DIALOG_WIDTH_PX = 460;
const CONFIG_DIALOG_WIDTH_PX = 500;
const STYLE_DIALOG_WIDTH_PX = 420;
const APP_DIALOG_WIDTH_PX = 540;
const MARKDOWN_DIALOG_WIDTH_PX = 600;

const DIALOGS = {
    'sync': () => ({title: _('Cloud Sync'), content: syncContent(), width: SYNC_DIALOG_WIDTH_PX}),
    'tooltips': () => ({title: _('Tooltips'), content: tooltipsContent(), width: CONFIG_DIALOG_WIDTH_PX}),
    'background': () => ({title: _('Background Apps'), content: backgroundContent(), width: CONFIG_DIALOG_WIDTH_PX}),
    'keep-open': () => ({title: KEEP_OPEN_TITLES[state.displayMode], content: keepOpenContent(), width: CONFIG_DIALOG_WIDTH_PX}),
    'toggle-icon': () => ({title: _('Icon'), content: toggleIconContent(), width: CONFIG_DIALOG_WIDTH_PX}),
    'color': key => ({title: colorDialogTitle(key), content: colorContent(key), width: STYLE_DIALOG_WIDTH_PX}),
    'action': key => ({title: actionTitle(key), content: actionContent(key), width: CONFIG_DIALOG_WIDTH_PX}),
    'app': id => ({title: displayName(appById(id)), content: appContent(id), width: APP_DIALOG_WIDTH_PX}),
    // Stacked over the app dialog like the real Adw.Dialog, closing goes back to it
    'status': id => ({title: _('Status Icons and Badges'), content: statusBadgeContent(id), width: STATUS_DIALOG_WIDTH_PX, parent: `app:${id}`}),
    'links': linkDialog,
    'credits': creditsDialog,
    'changelog': () => ({title: _('Changelog'), content: changelogContent(), width: MARKDOWN_DIALOG_WIDTH_PX}),
};

export function openModal(type) {
    ui.dialogType = type;
    renderModal();
    syncInert();
    // The dialog itself takes focus like pinDialogWidth in
    // src/prefs/components/dialog.js, a leading entry would pop the
    // on-screen keyboard
    overlay.querySelector('.pref-dialog').focus({preventScroll: true});
}

// The close button and Escape step back to a parent dialog where there is one
export function closeModalStep() {
    const [kind, argument] = ui.dialogType.split(':');
    const {parent} = DIALOGS[kind](argument);
    if (parent)
        openModal(parent);
    else
        closeModal();
}

export function closeModal() {
    closeDropdown();
    hidePrefTooltip();
    ui.dialogType = null;
    overlay.hidden = true;
    releasePage(DEMO_MODAL);
    overlay.replaceChildren();
    syncInert();
}

export function renderModal() {
    closeDropdown();
    hidePrefTooltip();
    const oldScroll = overlay.querySelector('.pref-dialog-body')?.scrollTop ?? 0;
    const focused = overlay.contains(document.activeElement) ? sameControlSelector(document.activeElement) : null;
    overlay.innerHTML = settingsDialog();
    const dialogBody = overlay.querySelector('.pref-dialog-body');
    dialogBody.scrollTop = oldScroll;
    overlay.hidden = false;
    applyClamp(dialogBody);
    holdPage(DEMO_MODAL, () => overlay.querySelector('.pref-dialog'));
    // The render replaces the control that had focus, its successor takes it
    // so Escape and Tab keep working
    if (focused)
        overlay.querySelector(focused)?.focus({preventScroll: true});
}

// The id and data attributes name a control across renders, the tooltip text does not
function sameControlSelector(element) {
    const attributes = [...element.attributes].filter(({name}) => name === 'id' || (name.startsWith('data-') && name !== 'data-pref-tooltip'));
    if (!attributes.length)
        return null;
    return attributes.map(({name, value}) => `[${name}="${CSS.escape(value)}"]`).join('');
}

function settingsDialog() {
    const [kind, argument] = ui.dialogType.split(':');
    const {title, content, width, titleWidget = ''} = DIALOGS[kind](argument);
    const hasDoubleClick = kind === 'action' && state[`${argument}Double`] !== 'None';
    const alert = hasDoubleClick ? alertMarkup(_('Single clicks are briefly delayed while a double-click action is set, so the second click can be detected.'), {variant: 'warning'}) : '';
    const hasReset = kind === 'action' || DIALOG_KEYS[kind] !== undefined;
    const reset = hasReset ? iconButton('reset', _('Reset'), 'data-native-reset="dialog"') : '';
    const closeButton = iconButton('close', `${_('Close')} ${title}`, 'data-native-modal-close', 'close');
    return dialogMarkup({title, end: reset + closeButton, body: alert + content, titleWidget, attributes: `tabindex="-1" style="--dialog-width:${width}px"`});
}
