import {closeAlert, confirmAlert} from './components/alert.js';
import {onStripWheel} from './components/card.js';
import {closeColorPicker, onPickerKey, openColorEditor, openColorPicker, pickDraft} from './components/colorPicker.js';
import {onModalKey} from './components/dialog.js';
import {openHelp} from './components/help.js';
import {openHeaderMenu} from './components/menu.js';
import {closeModal, closeModalStep, openModal, renderModal} from './components/modal.js';
import {PAGES, openPage, renderPage, showPage, showSubpage} from './components/page.js';
import {bindSettingUpdate, onAnyScroll, onDropdownClick, onDropdownKey, onDropdownPointer} from './components/popover.js';
import {onGuidePointer} from './components/guide.js';
import {spinPreviewToggle} from './components/preview.js';
import {expandExpander} from './components/expander.js';
import {addFilterToken, applyAppFilter, filter, onFilterBlur, onFilterFocus, onFilterKey, onFilterPointer, onFilterScroll, removeFilterToken} from './components/search.js';
import {fitSidebar, onSidebarKey, setSidebarShown} from './components/sidebar.js';
import {setSpacing, stepSpacing, toggleSpacingLink} from './components/spacing.js';
import {toast} from './components/toast.js';
import {createTooltip, hidePrefTooltip, onTooltipPointerOut, queuePrefTooltip, tooltipOwner} from './components/tooltip.js';
import {alertLayer, closeWindow, fitWindow, overlay, root, scheduleFit, sidebarShade, stage, createWindow} from './components/window.js';
import {loadOlderReleases, openChangelog, openCredits, showDialogTab} from './dialogs/aboutDialogs.js';
import {confirmForgetApp, renameApp, resetAppIcon, resetAppName} from './dialogs/appDialog.js';
import {openResetAlert} from './dialogs/resetDialog.js';
import {changeStateIcon, openPickerFor, submitStateName} from './dialogs/iconTargets.js';
import {startAddingState, toggleAccentRow} from './dialogs/statusBadgeDialog.js';
import {confirmDeleteBackup, confirmPull, confirmRestoreBackup, pushToFile, setSyncPath, useExampleSyncFile} from './dialogs/syncDialog.js';
import {loadContributors} from './pages/aboutPage.js';
import {openActionShortcut} from './pages/actionPage.js';
import {exportSettings, importSettings} from './pages/generalPage.js';
import {demo} from './landing/demoState.js';
import {desktop, reducedMotion} from './landing/elements.js';
import {_} from './shared/i18n.js';
import {accentValueKeeping, colorBehindAccent, usesAccent} from '../../src/shared/accentColor.js';
import {onDemoChange} from './shared/landingBridge.js';
import {slideRange, stepValue, update} from './shared/settings.js';
import {state, ui} from './shared/store.js';
import {views} from './shared/views.js';

const CLICK_ACTIONS = [
    ['data-load-contributors', loadContributors],
    ['data-sidebar-toggle', () => setSidebarShown(!ui.isSidebarShown)],
    ['data-native-page', button => showPage(button.dataset.nativePage)],
    ['data-pref-subpage', button => showSubpage(button.dataset.prefSubpage)],
    ['data-native-back', () => showSubpage(null)],
    ['data-pref-switch', button => update(button.dataset.prefSwitch, !state[button.dataset.prefSwitch])],
    ['data-accent-switch', button => update(button.dataset.accentSwitch, toggledAccent(state[button.dataset.accentSwitch]))],
    ['data-pref-set', button => update(button.dataset.prefSet, button.dataset.value)],
    ['data-pref-step', stepValue],
    ['data-dialog', button => openModal(button.dataset.dialog)],
    ['data-action-gear', button => openModal(`action:${button.dataset.actionGear}`)],
    ['data-pref-app', button => openModal(`app:${button.dataset.prefApp}`)],
    ['data-native-modal-close', () => closeModalStep()],
    ['data-badge-resting', () => toast(_('Resting state updated.'))],
    ['data-badge-accent', button => {
        toggleAccentRow(button.dataset.badgeAccent);
        renderModal();
    }],
    ['data-badge-add-state', button => {
        startAddingState(button.dataset.badgeAddState);
        expandExpander('status-icons');
        renderModal();
        overlay.querySelector('[data-badge-state-name]').focus({preventScroll: true});
    }],
    ['data-badge-state-reset', button => changeStateIcon(button, 'reset')],
    ['data-badge-state-remove', button => changeStateIcon(button, 'remove')],
    ['data-native-reset', button => openResetAlert(button.dataset.nativeReset)],
    ['data-alert-confirm', confirmAlert],
    ['data-alert-cancel', closeAlert],
    ['data-native-close', () => {
        closeModal();
        closeWindow();
    }],
    ['data-native-export', exportSettings],
    ['data-native-import', importSettings],
    ['data-native-link', button => globalThis.open(button.dataset.nativeLink, '_blank', 'noopener')],
    ['data-forget-app', button => confirmForgetApp(button.dataset.forgetApp)],
    ['data-reset-app-name', button => resetAppName(button.dataset.resetAppName)],
    ['data-toggle-native-preview', spinPreviewToggle],
    ['data-reset-app-icon', button => resetAppIcon(button.dataset.resetAppIcon)],
    ['data-help', openHelp],
    ['data-header-menu', openHeaderMenu],
    ['data-changelog', openChangelog],
    ['data-changelog-more', loadOlderReleases],
    ['data-credits', openCredits],
    ['data-link-dialog', button => openModal(`links:${button.dataset.linkDialog}`)],
    ['data-dialog-tab', button => showDialogTab(button.dataset.dialogTab)],
    ['data-chip-remove', button => removeFilterToken(button.dataset.chipRemove)],
    ['data-suggestion', button => addFilterToken(button.dataset.suggestion)],
    ['data-sync-example', useExampleSyncFile],
    ['data-sync-push', pushToFile],
    ['data-sync-pull', confirmPull],
    ['data-sync-backup-delete', button => confirmDeleteBackup(Number(button.dataset.syncBackupDelete))],
    ['data-sync-backup-restore', confirmRestoreBackup],
    ['data-color-picker', button => openColorPicker(button.dataset.colorPicker, button)],
    ['data-picker-value', button => pickDraft(button.dataset.pickerValue)],
    ['data-picker-cancel', () => closeColorPicker()],
    ['data-picker-confirm', () => closeColorPicker(true)],
    ['data-picker-add', openColorEditor],
    ['data-spacing-step', stepSpacing],
    ['data-spacing-link', toggleSpacingLink],
];

const LANDING_ACTIONS = [
    ['data-open-tab', link => openFromPage(link.dataset.openTab)],
    ['data-open-app', button => {
        openFromPage('applications');
        openModal(`app:${button.dataset.openApp}`);
    }],
    ['data-open-credits', (link, event) => {
        event.preventDefault();
        openFromPage('about');
        openCredits();
    }],
    ['data-pref-shortcut', link => openActionShortcut(link.dataset.prefShortcut)],
];

Object.assign(views, {renderPage, renderModal, openPage, openModal, closeModal});
bindSettingUpdate(update);
Object.assign(state, demo.getState());
createWindow(PAGES, fitSidebar);
createTooltip();
root.addEventListener('click', onRootClick);
root.addEventListener('input', onRootInput);
root.addEventListener('change', onRootChange);
root.addEventListener('keydown', onRootKey);
root.addEventListener('focusin', onFilterFocus);
root.addEventListener('focusout', onFilterBlur);
document.addEventListener('pointerdown', onFilterPointer, true);
document.addEventListener('scroll', onFilterScroll, true);
root.addEventListener('wheel', onStripWheel, {passive: false});
root.addEventListener('pointermove', onGuidePointer);
document.addEventListener('keydown', () => (document.documentElement.dataset.inputMode = 'keyboard'), true);
document.addEventListener('pointerdown', () => (document.documentElement.dataset.inputMode = 'pointer'), true);
root.addEventListener('pointerleave', onGuidePointer);
sidebarShade.addEventListener('click', () => setSidebarShown(false));
document.addEventListener('bti-preview-change', onDemoChange);
globalThis.addEventListener('resize', scheduleFit, {passive: true});
new ResizeObserver(scheduleFit).observe(stage);

// Fitting before the first paint keeps a narrow window from sliding its
// sidebar out on load
fitWindow();

// Delegated, the German swap replaces the footer link
document.addEventListener('click', onLandingClick);
document.addEventListener('click', onDropdownClick);
document.addEventListener('keydown', onDropdownKey);
document.addEventListener('pointerdown', onDropdownPointer, {passive: true});

document.addEventListener('pointerover', queueTooltipFor);
document.addEventListener('pointerout', onTooltipPointerOut);
document.addEventListener('focusin', queueTooltipFor);
document.addEventListener('focusout', hidePrefTooltip);
document.addEventListener('scroll', onAnyScroll, true);

renderPage();

// A bare accent has no color behind it to come back to, so it stays on
function toggledAccent(value) {
    return usesAccent(value) ? colorBehindAccent(value) ?? value : accentValueKeeping(value);
}

// The demo window lives on the hero desktop, a button further down brings it into view
function openFromPage(key) {
    openPage(key);
    desktop.scrollIntoView({behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start'});
}

function onLandingClick(event) {
    for (const [attribute, run] of LANDING_ACTIONS) {
        const element = event.target.closest(`[${attribute}]`);
        if (element) {
            run(element, event);
            return;
        }
    }
}

function queueTooltipFor(event) {
    const target = tooltipOwner(event.target);
    if (target)
        queuePrefTooltip(target);
}

function onRootClick(event) {
    const button = event.target.closest('button');
    const pickerRow = event.target.closest('[data-native-icon-picker]');
    // A button inside the row, a reset for one, does its own job only
    if (pickerRow && !button) {
        openPickerFor(pickerRow);
        return;
    }
    if (!button) {
        onBareClick(event.target);
        return;
    }
    const action = CLICK_ACTIONS.find(([attribute]) => button.hasAttribute(attribute));
    if (action)
        action[1](button);
}

// A row holding a switch flips it from anywhere, like GTK's activatable row
function onBareClick(target) {
    const caption = target.closest('[data-card-pick]');
    if (caption) {
        update(caption.dataset.cardPick, caption.dataset.value);
        return;
    }
    const row = target.closest('.pref-row');
    const rowSwitch = row && row.querySelector(':scope > .pref-row-suffix > .pref-switch:not(:disabled)');
    if (rowSwitch)
        rowSwitch.click();
}

function onRootInput(event) {
    const {target} = event;
    if (target.id === 'native-sync-path') {
        setSyncPath(target.value);
        return;
    }
    if (target.dataset.appName) {
        renameApp(target.dataset.appName, target.value);
        return;
    }
    if (target.dataset.prefRange) {
        slideRange(target);
        return;
    }
    if (target.id === 'pref-app-filter') {
        filter.query = target.value.trim().toLowerCase();
        applyAppFilter();
        return;
    }
    if (target.matches('input[data-spacing-kind]')) {
        const {spacingKind, spacingType, spacingSide} = target.dataset;
        setSpacing(spacingKind, spacingType, spacingSide, target.value);
    }
}

function onRootChange(event) {
    const {target} = event;
    if (!target.dataset.prefRange)
        return;
    const selector = `[data-pref-range="${target.dataset.prefRange}"][type="${target.type}"]`;
    update(target.dataset.prefRange, state[target.dataset.prefRange]);
    root.querySelector(selector)?.focus({preventScroll: true});
}

function onRootKey(event) {
    const isActivation = event.key === 'Enter' || event.key === ' ';
    if (isActivation && event.target.matches('div[data-native-icon-picker]')) {
        event.preventDefault();
        openPickerFor(event.target);
        return;
    }
    if (ui.picker) {
        onPickerKey(event);
        return;
    }
    if (ui.dropdownPopover)
        return;
    if (ui.alert) {
        onModalKey(event, alertLayer, closeAlert);
        return;
    }
    if (ui.dialogType) {
        if (event.key === 'Enter' && event.target.dataset.badgeStateName) {
            submitStateName(event.target);
            return;
        }
        onModalKey(event, overlay, closeModalStep);
        return;
    }
    if (event.target.dataset.nativePage) {
        onSidebarKey(event);
        return;
    }
    if (event.target.id === 'pref-app-filter') {
        onFilterKey(event);
        return;
    }
    if (event.key === 'Escape' && ui.isSidebarShown) {
        setSidebarShown(false);
        root.querySelector('[data-sidebar-toggle]').focus({preventScroll: true});
    }
}
