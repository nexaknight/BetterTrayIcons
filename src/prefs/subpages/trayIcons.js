import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {createSpinRow, buildPrefsWidget, createIconColorPair} from '../widgets/rows.js';

export default class TrayIconsSubpage extends Adw.NavigationPage {
    static {
        GObject.registerClass(this);
    }

    _init(window, settings) {
        super._init({
            title: _('Tray Icons'),
            tag: 'tray_icons_settings',
        });

        this._window = window;
        this._settings = settings;

        this._settingsKeys = [
            'icon-size',
            'icon-padding-horizontal',
            'icon-padding-vertical',
            'icon-color',
            'icon-hover-color',
            'icon-background-color',
            'icon-hover-background-color',
            'icon-border-radius',
            'enable-symbolic-icons',
        ];

        this._buildUI();
    }

    _buildUI() {
        const page = buildPrefsWidget(this, this._settings, this._settingsKeys);

        const groupStyle = new Adw.PreferencesGroup({title: _('Style')});
        page.add(groupStyle);

        const symbolicRow = new Adw.SwitchRow({
            title: _('Symbolic Icons'),
            subtitle: _('Use monochrome icons when available.'),
        });
        this._settings.bind('enable-symbolic-icons', symbolicRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        groupStyle.add(symbolicRow);

        const groupSize = new Adw.PreferencesGroup({title: _('Size')});
        page.add(groupSize);
        groupSize.add(createSpinRow(_('Icon Size (px)'), this._settings, 'icon-size', 16, 128, 2));
        groupSize.add(createSpinRow(_('Corner Radius (px)'), this._settings, 'icon-border-radius', 0, 50));

        const groupPadding = new Adw.PreferencesGroup({title: _('Padding')});
        page.add(groupPadding);
        groupPadding.add(createSpinRow(_('Horizontal (px)'), this._settings, 'icon-padding-horizontal', 0, 50, 1));
        groupPadding.add(createSpinRow(_('Vertical (px)'), this._settings, 'icon-padding-vertical', 0, 50, 1));

        const groupColor = new Adw.PreferencesGroup({title: _('Colors')});
        page.add(groupColor);
        createIconColorPair(this._window, this._settings, 'icon-').forEach(r => groupColor.add(r));
    }
}
