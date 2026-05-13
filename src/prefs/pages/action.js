import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {createComplexActionRow} from '../widgets/rows.js';
import ActionConfigWidget from '../widgets/actionConfigWidget.js';

export class ActionPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    _init(window, settings) {
        super._init({
            title: _('Actions'),
            icon_name: 'preferences-other-symbolic',
        });

        this._window = window;
        this._settings = settings;

        this._clickButtons = [
            {label: _('Left Click'),   suffix: 'left'},
            {label: _('Middle Click'), suffix: 'middle'},
            {label: _('Right Click'),  suffix: 'right'},
        ];

        this.actionOptions = [_('Activate'), _('Open Menu'), _('None')];
        this.actionValues = ['activate', 'menu', 'nothing'];

        this.trayLongOptions = [_('Activate'), _('Open Menu'), _('Reorder (drag & drop)'), _('None')];
        this.trayLongValues = ['activate', 'menu', 'drag-drop', 'nothing'];

        this.toggleOptions = [
            _('Toggle Menu'),
            _('Cycle Icons'),
            _('Action Menu'),
            _('Open Settings'),
            _('None'),
        ];
        this.toggleValues = ['toggle', 'cycle', 'action-menu', 'prefs', 'nothing'];

        this._createTrayClickGroup();
        this._createToggleClickGroup();
    }

    _createTrayClickGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Tray Icon Clicks'),
            description: _('Open the gear for double-click and long-press.'),
        });
        this.add(group);

        this._addClickRows(group, {
            keyPrefix: 'tray-action',
            options: this.actionOptions,
            values: this.actionValues,
            longOptions: this.trayLongOptions,
            longValues: this.trayLongValues,
        });
    }

    _createToggleClickGroup() {
        const group = new Adw.PreferencesGroup({title: _('Toggle Button Clicks')});
        this.add(group);

        this._addClickRows(group, {
            keyPrefix: 'toggle-action',
            options: this.toggleOptions,
            values: this.toggleValues,
            longOptions: this.toggleOptions,
            longValues: this.toggleValues,
        });
    }

    _addClickRows(group, {keyPrefix, options, values, longOptions, longValues}) {
        this._clickButtons.forEach(({label, suffix}) => {
            const key = `${keyPrefix}-${suffix}`;
            const advData = {
                pageTitle: label,
                groupTitle: _('Advanced'),
                configs: [
                    {type: 'combo', title: _('Double Click'), key: `${key}-double`, options,     values},
                    {type: 'combo', title: _('Long Press'),   key: `${key}-long`,   options: longOptions, values: longValues},
                ],
            };
            group.add(createComplexActionRow(
                label, null, this._settings, key,
                options, values, this._window, ActionConfigWidget, advData
            ));
        });
    }
}
