import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import ToggleButtonSubpage from '../subpages/toggleButton.js';
import OverflowMenuSubpage from '../subpages/overflowMenu.js';
import TrayIconsSubpage from '../subpages/trayIcons.js';

import {createSwitchRow, createSubpageRow} from '../widgets/rows.js';

export class AppearancePage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    _init(window, settings) {
        super._init({
            title: _('Appearance'),
            icon_name: 'applications-graphics-symbolic',
        });

        this._window = window;
        this._settings = settings;

        this._addSurfaceGroup({
            title: _('Tray Icons'),
            switchTitle: _('Custom Style'),
            switchKey: 'enable-custom-icon-style',
            subpageTitle: _('Configure'),
            subpageSubtitle: _('Size, padding, colors'),
            subpageClass: TrayIconsSubpage,
        });

        this._addToggleButtonGroup();

        this._addSurfaceGroup({
            title: _('Overflow Menu'),
            switchTitle: _('Custom Style'),
            switchKey: 'enable-custom-overflow-style',
            subpageTitle: _('Configure'),
            subpageSubtitle: _('Background, radius, spacing'),
            subpageClass: OverflowMenuSubpage,
        });
    }

    _addSurfaceGroup({title, switchTitle, switchKey, subpageTitle, subpageSubtitle, subpageClass}) {
        const group = new Adw.PreferencesGroup({title});
        this.add(group);

        group.add(createSwitchRow(switchTitle, null, this._settings, switchKey));
        group.add(createSubpageRow(
            subpageTitle, subpageSubtitle,
            this._window, subpageClass, this._settings, switchKey
        ));
    }

    _addToggleButtonGroup() {
        const group = new Adw.PreferencesGroup({title: _('Toggle Button')});
        this.add(group);
        group.add(createSubpageRow(
            _('Configure'), _('Icon, position, colors'),
            this._window, ToggleButtonSubpage, this._settings
        ));
    }
}
