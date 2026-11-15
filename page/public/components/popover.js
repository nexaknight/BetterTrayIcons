import {NAVIGATION_STEPS} from './contextMenu.js';
import {POPUP_GAP_PX, hidePrefTooltip} from './tooltip.js';
import {rectInScope, root} from './window.js';
import {state, ui} from '../shared/store.js';
import {clamp, escapeHtml} from '../shared/util.js';
import {buttonMarkup} from './button.js';

const POPOVER_EDGE_PX = 8;
const POPOVER_MIN_WIDTH_PX = 150;
const OPEN_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', ' '];
const selectHandlers = new Map();
let updateSetting;

// settings.js redraws the page this module draws on, so prefs.js hands its
// update in instead of an import running back up
export function bindSettingUpdate(update) {
    updateSetting = update;
}

// A dropdown outside the settings store, the page's own dialogs use it
export function bindSelect(key, handler) {
    selectHandlers.set(key, handler);
}

export function openDropdown(trigger, focusAt = 'selected') {
    const handler = selectHandlers.get(trigger.dataset.prefSelectTrigger);
    const selected = handler ? handler.getValue() : state[trigger.dataset.prefSelectTrigger];
    const options = JSON.parse(trigger.dataset.prefOptions).map(option => typeof option === 'string' ? {value: option, label: option} : option);
    const markup = options.map(({value, label}) => optionMarkup(value, label, selected === value)).join('');
    const popover = openPopover(trigger, markup, 'listbox');
    if (!popover)
        return;
    const items = [...popover.querySelectorAll('[role=option]')];
    const focusTargets = {
        first: items[0],
        last: items.at(-1),
        selected: items.find(item => item.getAttribute('aria-selected') === 'true') ?? items[0],
    };
    const focusTarget = focusTargets[focusAt];
    focusTarget.focus({preventScroll: true});
}

function optionMarkup(value, label, isSelected) {
    return buttonMarkup({title: `<span>${escapeHtml(label)}</span>`, trailing: `<span class="pref-option-check" aria-hidden="true">${isSelected ? '✓' : ''}</span>`, attributes: `role="option" aria-selected="${isSelected}" data-pref-option="${escapeHtml(value)}"`});
}

// One floating surface at a time, shared by dropdowns, menus and help
export function openPopover(trigger, markup, role, className = '', {width = 0} = {}) {
    if (ui.dropdownTrigger === trigger) {
        closeDropdown(true);
        return null;
    }
    closeDropdown();
    hidePrefTooltip();
    ui.dropdownTrigger = trigger;
    const scope = trigger.closest('.prefs-native');
    const popover = document.createElement('div');
    popover.className = `pref-dropdown-popover bti-select-popover ${className}`;
    popover.id = 'pref-dropdown-list';
    popover.setAttribute('role', role);
    popover.setAttribute('aria-label', trigger.getAttribute('aria-label'));
    popover.innerHTML = markup;
    scope.append(popover);
    ui.dropdownPopover = popover;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', popover.id);
    placePopover(popover, trigger, scope, width);
    return popover;
}

// A fixed width, as the icon picker has, centres the popover on its trigger
function placePopover(popover, trigger, scope, fixedWidth = 0) {
    const rect = rectInScope(trigger, scope);
    const width = fixedWidth || Math.max(POPOVER_MIN_WIDTH_PX, rect.width, popover.offsetWidth);
    const left = fixedWidth ? rect.left + rect.width / 2 - width / 2 : rect.left;
    popover.style.width = `${width}px`;
    const below = rect.bottom + POPUP_GAP_PX;
    const fitsBelow = below + popover.offsetHeight < scope.offsetHeight - POPOVER_EDGE_PX;
    const top = fitsBelow ? below : rect.top - popover.offsetHeight - POPUP_GAP_PX;
    popover.style.left = `${clamp(left, POPOVER_EDGE_PX, scope.offsetWidth - width - POPOVER_EDGE_PX)}px`;
    popover.style.top = `${Math.max(POPOVER_EDGE_PX, top)}px`;
}

export function closeDropdown(shouldRestoreFocus = false) {
    const trigger = ui.dropdownTrigger;
    ui.dropdownPopover?.remove();
    ui.dropdownPopover = null;
    ui.dropdownTrigger = null;
    if (!trigger?.isConnected)
        return;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    if (shouldRestoreFocus)
        trigger.focus({preventScroll: true});
}

export function onDropdownClick(event) {
    if (ui.picker)
        return;
    const trigger = event.target.closest('[data-pref-select-trigger]');
    if (trigger) {
        openDropdown(trigger);
        return;
    }
    const option = event.target.closest('[data-pref-option]');
    if (option)
        chooseOption(option.dataset.prefOption);
}

function chooseOption(value) {
    const trigger = ui.dropdownTrigger;
    const key = trigger.dataset.prefSelectTrigger;
    const handler = selectHandlers.get(key);
    closeDropdown();
    if (handler) {
        handler.choose(value);
        return;
    }
    updateSetting(key, value);
    root.querySelector(`[data-pref-select-trigger="${key}"]`).focus({preventScroll: true});
}

export function onDropdownKey(event) {
    if (ui.picker)
        return;
    const trigger = event.target.closest('[data-pref-select-trigger]');
    if (!ui.dropdownPopover && trigger && OPEN_KEYS.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        openDropdown(trigger, event.key === 'ArrowUp' ? 'last' : 'selected');
        return;
    }
    if (!ui.dropdownPopover)
        return;
    const step = NAVIGATION_STEPS[event.key];
    if (step) {
        event.preventDefault();
        event.stopPropagation();
        const items = [...ui.dropdownPopover.querySelectorAll('[role=option],[role=menuitem]')];
        if (!items.length)
            return;
        items[step(items.indexOf(document.activeElement), items.length)].focus({preventScroll: true});
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDropdown(true);
        return;
    }
    if (event.key === 'Tab')
        closeDropdown(true);
}

export function onDropdownPointer(event) {
    if (!ui.dropdownPopover)
        return;
    const isOutside = !ui.dropdownPopover.contains(event.target) && !ui.dropdownTrigger.contains(event.target);
    if (isOutside)
        closeDropdown();
}

export function onAnyScroll(event) {
    const isPrefScroll = event.target.closest?.('.pref-scroll,.pref-dialog-body');
    if (isPrefScroll && !ui.dropdownPopover?.contains(event.target))
        closeDropdown();
    hidePrefTooltip();
}
