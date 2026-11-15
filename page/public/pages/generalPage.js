import {smallButton} from '../components/button.js';
import {cardGroup, choiceCard} from '../components/card.js';
import {group} from '../components/group.js';
import {icon, iconButton} from '../components/icon.js';
import {row, switchRow, toggleGroupRow} from '../components/row.js';
import {toast} from '../components/toast.js';
import {panelScene} from '../scenes/panelScene.js';
import {quickSettingsScene} from '../scenes/quickSettingsScene.js';
import {_} from '../shared/i18n.js';
import {isPanelMode, state} from '../shared/store.js';

const MINIMIZE_HELP = _('Many apps hide themselves to the tray when their icon is clicked a second time while they are in front. Some apps do not support that. This setting gives them a similar behavior.\n\n' +
    '• Per App: set it for each app under Applications. Apps that already hide to the tray keep their own behavior.\n' +
    '• Minimize: applies to every app. A second click minimizes the app, and it stays visible in the dock.\n' +
    '• Close: closes the app’s window in front. Some apps quit entirely instead of staying in the tray, and unsaved work can be lost.');

const MODE_CARDS = [['popup', _('Popup')], ['drawer', _('Drawer')], ['background-apps', _('In Background Apps')]];
const WHEN_IN_FRONT_OPTIONS = [['none', _('Per App')], ['minimize', _('Minimize')], ['close', _('Close')]];

export function generalPage() {
    const mode = state.displayMode;
    const keepOpenTitle = mode === 'background-apps' ? _('Keep Quick Settings Open') : _('Keep Overflow Menu Open');
    const behavior = [
        switchRow(_('Wine App Icons'), 'wine', _('Show icons from Wine, Proton and other legacy X11 tray apps.')),
        mode === 'drawer' ? '' : switchRow(keepOpenTitle, 'keepOpen', _('Stays open after icon clicks and context menus alike.'), {dialog: 'keep-open', isGearAlwaysLive: true}),
        mode === 'drawer' ? switchRow(_('Remember Drawer State'), 'drawerRemember', _('Stays open until the toggle button closes it.'), {dialog: 'keep-open', isGearAlwaysLive: true}) : '',
        isPanelMode() ? switchRow(_('Hide Background Apps'), 'hideBackground', _("Removes GNOME's own list of windowless apps from Quick Settings."), {dialog: 'background'}) : '',
        isPanelMode() ? switchRow(_('Show Tooltips'), 'tooltips', _('Show the app title on hover.'), {dialog: 'tooltips'}) : '',
        toggleGroupRow(_('Minimize Action for Unsupported Apps'), 'whenInFront', WHEN_IN_FRONT_OPTIONS, {
            subtitle: _('For apps that do not hide themselves when their icon is clicked while they are in front.'),
            badgeText: _('Experimental'),
            help: MINIMIZE_HELP,
        }),
    ].join('');
    const advanced = row(_('Backup and Restore'), _('Save settings as JSON or load them back.'), iconButton('import', _('Import'), 'data-native-import') + iconButton('export', _('Export'), 'data-native-export')) +
        row(_('Cloud Sync'), _('Keep settings in sync via a shared file.'), icon('sync'), '', 'type="button" data-dialog="sync"');
    const danger = row(_('Factory Reset'), _('Restore defaults and delete sync backups.'), smallButton(_('Reset'), 'data-native-reset="all"', 'destructive'));
    const modes = MODE_CARDS.map(([value, label]) =>
        choiceCard({key: 'displayMode', value, label, scene: value === 'background-apps' ? quickSettingsScene() : panelScene(state.panelPosition, value)})
    ).join('');
    return cardGroup(_('Mode'), '', modes) + group(_('Behavior'), behavior) + group(_('Advanced'), advanced) + group(_('Danger Zone'), danger);
}

// The page has no files to write or read, the buttons only answer
export function exportSettings() {
    toast(_('Settings exported'));
}

export function importSettings() {
    toast(_('Settings imported'));
}
