import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {resetKeys} from '../../shared/settingsIO.js';
import {createIconButton} from './button.js';
import {buildDialogShell, showConfirmationDialog} from './dialog.js';
import {addToast, createSidebarToggle, popSubpage} from './sidebar.js';

export function buildPrefsWidget(page, settings, keysToReset, {window = null} = {}) {
    const {toolbarView, headerBar, page: contentPage} = buildDialogShell();
    page.set_child(toolbarView);

    if (window) {
        // The stock back button lands left of the sidebar toggle and brings
        // its own chevron, so the subpage packs both by hand.
        headerBar.show_back_button = false;
        headerBar.pack_start(createSidebarToggle(window));
        headerBar.pack_start(createIconButton('bti-previous-symbolic', {
            tooltip: _('Back'),
            onClick: () => popSubpage(window),
        }));
    }

    if (keysToReset.length > 0)
        headerBar.pack_end(createResetButton({settings, keys: keysToReset, window}));

    return contentPage;
}

export function createResetButton({settings, keys, window, includesSubpages = false}) {
    const resetButton = createIconButton('bti-reset-symbolic', {
        circular: true,
        tooltip: _('Reset'),
        onClick: () => showConfirmationDialog(resetButton.get_root(), {
            title: _('Reset these settings?'),
            message: includesSubpages
                ? _('All values of this page, including its dialogs and subpages, will be restored to their defaults.')
                : _('All values on this page will be restored to their defaults.'),
            confirmLabel: _('Reset'),
            destructive: true,
            onConfirm: () => {
                resetKeys(settings, keys);
                if (window)
                    addToast(window, new Adw.Toast({title: _('Settings reset')}));
            },
        }),
    });
    return resetButton;
}
