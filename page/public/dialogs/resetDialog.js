import {openAlert} from '../components/alert.js';
import {_} from '../shared/i18n.js';
import {PAGE_KEYS, SUBPAGE_KEYS, clearAppConfigs, dialogResetKeys, factoryReset, resetSettings} from '../shared/settings.js';
import {ui} from '../shared/store.js';

const ON_THIS_PAGE = _('All values on this page will be restored to their defaults.');

const RESET_ALERTS = {
    'page': () => ({
        heading: _('Reset these settings?'),
        body: ui.subpage ? ON_THIS_PAGE : _('All values of this page, including its dialogs and subpages, will be restored to their defaults.'),
        confirmLabel: _('Reset'),
        onConfirm: () => resetSettings(ui.subpage ? SUBPAGE_KEYS[ui.subpage] : PAGE_KEYS[ui.page]),
    }),
    'dialog': () => ({heading: _('Reset these settings?'), body: ON_THIS_PAGE, confirmLabel: _('Reset'), onConfirm: () => resetSettings(dialogResetKeys())}),
    'all': () => ({
        heading: _('Reset all settings?'),
        body: _('All settings will be restored to defaults and sync backups deleted. This cannot be undone.'),
        confirmLabel: _('Reset'),
        onConfirm: factoryReset,
    }),
    'apps-forget': () => ({
        heading: _('Forget all apps?'),
        body: _('Deletes all stored settings for every detected app. Running apps are re-detected right away.'),
        confirmLabel: _('Forget All'),
        onConfirm: () => clearAppConfigs(_('All apps forgotten')),
    }),
    'apps-reset': () => ({
        heading: _('Reset all apps?'),
        body: _('Restores every setting of every detected app to its default, name, icon, status icons and hiding included. Their order is kept.'),
        confirmLabel: _('Reset All'),
        onConfirm: () => clearAppConfigs(_('All apps reset')),
    }),
};

export function openResetAlert(kind) {
    openAlert(RESET_ALERTS[kind]());
}
