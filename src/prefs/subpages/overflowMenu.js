import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {createColorRow, createSpinRow, buildPrefsWidget, createBoxSidesGroup} from '../widgets/rows.js';

export default class OverflowMenuSubpage extends Adw.NavigationPage {
    static {
        GObject.registerClass(this);
    }

    _init(window, settings) {
        super._init({
            title: _('Overflow Container'),
            tag: 'overflow_menu_settings',
        });

        this._settings = settings;
        this._settingsKeys = [
            'overflow-container-padding-top',
            'overflow-container-padding-bottom',
            'overflow-container-padding-left',
            'overflow-container-padding-right',
            'overflow-container-margin-top',
            'overflow-container-margin-bottom',
            'overflow-container-margin-left',
            'overflow-container-margin-right',
            'overflow-container-background-color',
            'overflow-container-border-radius',
        ];

        this._buildUI();
    }

    _buildUI() {
        const contentPage = buildPrefsWidget(this, this._settings, this._settingsKeys);

        const groupStyle = new Adw.PreferencesGroup({title: _('Style')});
        contentPage.add(groupStyle);
        groupStyle.add(createColorRow(_('Background'), this._settings, 'overflow-container-background-color'));
        groupStyle.add(createSpinRow(_('Corner Radius (px)'), this._settings, 'overflow-container-border-radius', 0, 50));

        contentPage.add(createBoxSidesGroup(_('Padding'), this._settings, 'overflow-container-padding'));
        contentPage.add(createBoxSidesGroup(_('Margin'),  this._settings, 'overflow-container-margin'));
    }
}
