import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {ACTION_DROPDOWN_WIDTH_PX, PANEL_DISPLAY_MODES, bindVisibility, createComplexActionRow, createComboRow, createActionRow} from '../components/row.js';
import {createResetButton} from '../components/page.js';
import {GEAR_ICON_NAME} from '../components/icon.js';
import {createHelpButton, createIconButton} from '../components/button.js';
import ConfigDialog from '../dialogs/configDialog.js';
import {TOUCH_BINDING} from '../../const.js';

// Every click, tap and scroll binding shares these prefixes, including the
// gear dialog keys, so a future binding resets without a list edit.
const ACTION_KEY_PREFIXES = Object.freeze(['tray-action-', 'toggle-action-']);

export class ActionPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsActionPage'}, this);
    }

    _init(window, settings) {
        super._init({
            title: _('Actions'),
            icon_name: 'bti-actions-symbolic',
        });

        this._window = window;
        this._settings = settings;
        this._headerActions = null;

        this._clickButtons = [
            {label: _('Left Click'),   suffix: 'left'},
            {label: _('Middle Click'), suffix: 'middle'},
            {label: _('Right Click'),  suffix: 'right'},
        ];

        this._actionOptions = [_('Activate'), _('Open Menu'), _('None')];
        this._actionValues = ['activate', 'menu', 'nothing'];

        this._trayLongOptions = [_('Activate'), _('Open Menu'), _('Reorder (drag & drop)'), _('None')];
        this._trayLongValues = ['activate', 'menu', 'drag-drop', 'nothing'];

        this._toggleOptions = [
            _('Toggle Menu'),
            _('Cycle Icons'),
            _('Action Menu'),
            _('Open BTI Settings'),
            _('None'),
        ];
        this._toggleValues = ['toggle', 'cycle', 'action-menu', 'prefs', 'nothing'];

        this._createTrayClickGroup();
        this._createToggleClickGroup();
    }

    get headerActions() {
        this._headerActions ??= createResetButton({
            settings: this._settings,
            keys: this._actionKeys(),
            window: this._window,
            includesSubpages: true,
        });
        return this._headerActions;
    }

    _actionKeys() {
        return [
            ...this._settings.list_keys().filter(key =>
                ACTION_KEY_PREFIXES.some(prefix => key.startsWith(prefix))),
            'toggle-hover-menu',
        ];
    }

    _createTrayClickGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Tray Icon Clicks'),
        });
        this.add(group);

        this._addClickRows(group, {
            keyPrefix: 'tray-action',
            options: this._actionOptions,
            values: this._actionValues,
            longOptions: this._trayLongOptions,
            longValues: this._trayLongValues,
        });

        // Only Quick Settings puts the icons in a list that scrolls
        const scrollHelp = createHelpButton(_('Forward to the App sends your mouse wheel to the app behind the icon. Apps that support it react, for example by switching devices or changing the volume. Most apps take the wheel and do nothing with it.\n\nIn Background Apps mode the wheel then no longer scrolls the Quick Settings list while the pointer is over such an icon, because the event goes to the app. To keep the list scrolling, set this to None and pick Forward only for the apps that use it, in their own settings under Applications.'), {compact: true});
        bindVisibility(this._settings, 'display-mode', scrollHelp, 'background-apps');
        group.add(createComboRow({
            title: _('Scroll'),
            settings: this._settings,
            key: 'tray-action-scroll',
            options: [_('Forward to the App'), _('None')],
            values: ['forward', 'nothing'],
            width: ACTION_DROPDOWN_WIDTH_PX,
            help: scrollHelp,
        }));
    }

    _createToggleClickGroup() {
        const group = new Adw.PreferencesGroup({title: _('Toggle Button Clicks')});
        this.add(group);
        bindVisibility(this._settings, 'display-mode', group, PANEL_DISPLAY_MODES);

        this._addClickRows(group, {
            keyPrefix: 'toggle-action',
            options: this._toggleOptions,
            values: this._toggleValues,
            longOptions: this._toggleOptions,
            longValues: this._toggleValues,
        });

        group.add(createComboRow({
            title: _('Scroll'),
            subtitle: _('Scroll direction picks which way the icons rotate'),
            settings: this._settings,
            key: 'toggle-action-scroll',
            options: [_('Cycle Icons'), _('None')],
            values: ['cycle', 'nothing'],
        }));

        // The drawer is no menu, the action menu is the only one left to pick
        const hoverRow = createComboRow({
            title: _('Menu on Hover'),
            subtitle: _('Which menu opens when you move onto the toggle button while another panel menu is open'),
            settings: this._settings,
            key: 'toggle-hover-menu',
            options: [_('Overflow Popup'), _('Action Menu')],
            values: ['overflow', 'action-menu'],
        });
        bindVisibility(this._settings, 'display-mode', hoverRow, 'popup');
        group.add(hoverRow);
    }

    _addClickRows(group, {keyPrefix, options, values, longOptions, longValues}) {
        this._clickButtons.forEach(({label, suffix}) => {
            const key = `${keyPrefix}-${suffix}`;
            const groups = [{
                title: _('Advanced'),
                configs: [
                    {type: 'combo', title: _('Double Click'), key: `${key}-double`, options,     values},
                    {type: 'combo', title: _('Long Press'),   key: `${key}-long`,   options: longOptions, values: longValues},
                ],
            }];

            group.add(createComplexActionRow({
                title: label,
                settings: this._settings,
                key,
                options,
                values,
                window: this._window,
                DialogClass: ConfigDialog,
                dialogData: {pageTitle: label, groups},
            }));
        });

        group.add(this._createTouchRow(keyPrefix, {options, values, longOptions, longValues}));
    }

    // Touch has no primary binding a dropdown could show, all three live in
    // the dialog.
    _createTouchRow(keyPrefix, {options, values, longOptions, longValues}) {
        const openDialog = () => new ConfigDialog(this._window, this._settings, {
            pageTitle: _('Touch'),
            groups: [{
                configs: [
                    {type: 'combo', title: _('Tap'),        key: `${keyPrefix}-${TOUCH_BINDING}`, options, values},
                    {type: 'combo', title: _('Double Tap'), key: `${keyPrefix}-${TOUCH_BINDING}-double`, options, values},
                    {type: 'combo', title: _('Long Touch'), key: `${keyPrefix}-${TOUCH_BINDING}-long`, options: longOptions, values: longValues},
                ],
            }],
        }).present(this._window);

        return createActionRow({
            title: _('Touch'),
            subtitle: _('Tap, double tap and long touch.'),
            suffixWidgets: [createIconButton(GEAR_ICON_NAME, {
                tooltip: _('Configure'),
                onClick: openDialog,
            })],
            onActivate: openDialog,
        });
    }
}
