import {openIconPicker} from '../components/iconPicker.js';
import {toast} from '../components/toast.js';
import {overlay, root} from '../components/window.js';
import {ATTENTION_STATE_KEY, addState, removeStateIcon, setStateIcon} from './statusBadgeDialog.js';
import {refreshApps} from '../components/quickSettings.js';
import {update} from '../shared/settings.js';
import {state} from '../shared/store.js';
import {views} from '../shared/views.js';

// RECOMMENDED_TOGGLE_ICONS in src/prefs/subpages/toggleButtonSubpage.js,
// only the ones the repo ships, the theme's names have no file here
const RECOMMENDED_TOGGLE_ICONS = ['bti-previous-symbolic', 'bti-next-symbolic'];

export function openPickerFor(row) {
    const target = row.dataset.nativeIconPicker;
    const [kind, id] = target.split(':');
    // The render replaces the row, focus goes back to its successor
    const refocus = () => root.querySelector(`[data-native-icon-picker="${target}"]`)?.focus({preventScroll: true});
    if (kind === 'status') {
        const [, appId, stateKey] = target.split(':');
        const onSelect = value => {
            setStateIcon(appId, stateKey, value);
            refreshApps();
            views.renderModal();
            refocus();
        };
        openIconPicker(row, {current: state.appConfigs[appId].stateIcons?.[stateKey] ?? '', onSelect});
        return;
    }
    if (kind === 'app') {
        const config = state.appConfigs[id];
        const onSelect = value => {
            config.icon = value;
            refreshApps();
            views.renderPage(true);
            views.renderModal();
            refocus();
        };
        openIconPicker(row, {current: config.icon ?? '', onSelect});
        return;
    }
    const onSelect = value => {
        update(id, value);
        refocus();
    };
    openIconPicker(row, {current: state[id], icons: RECOMMENDED_TOGGLE_ICONS, onSelect});
}

// Seen states keep their row, a reset only drops a manual state's icon
export function changeStateIcon(button, change) {
    const {appId} = button.dataset;
    const stateKey = button.dataset.badgeStateReset ?? button.dataset.badgeStateRemove;
    if (change === 'reset' && stateKey !== ATTENTION_STATE_KEY)
        setStateIcon(appId, stateKey, null);
    else
        removeStateIcon(appId, stateKey);
    refreshApps();
    views.renderModal();
}

export function submitStateName(input) {
    const appId = input.dataset.badgeStateName;
    const error = addState(appId, input.value);
    if (error) {
        toast(error);
        return;
    }
    views.renderModal();
    const row = overlay.querySelector(`[data-native-icon-picker="status:${appId}:${CSS.escape(input.value.trim())}"]`);
    if (row)
        openPickerFor(row);
}
