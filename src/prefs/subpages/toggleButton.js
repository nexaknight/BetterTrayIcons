import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';
import {
    createSpinRow,
    createComboRow,
    createIconPickerRow,
    createSwitchRow,
    buildPrefsWidget,
    createBoxSidesGroup,
    createIconColorPair,
} from '../widgets/rows.js';
import IconPickerWidget from '../widgets/iconPicker.js';
import {RECOMMENDED_TOGGLE_ICONS} from '../../const.js';

export default class ToggleButtonSubpage extends Adw.NavigationPage {
    static {
        GObject.registerClass(this);
    }

    _init(window, settings) {
        super._init({
            title: _('Toggle Button'),
            tag: 'toggle_button_settings',
        });

        this._window = window;
        this._settings = settings;

        this._settingsKeys = [
            'toggle-position',
            'toggle-icon-name',
            'toggle-icon-size',
            'toggle-padding-top',
            'toggle-padding-bottom',
            'toggle-padding-left',
            'toggle-padding-right',
            'toggle-margin-top',
            'toggle-margin-bottom',
            'toggle-margin-left',
            'toggle-margin-right',
            'toggle-icon-color',
            'toggle-icon-hover-color',
            'toggle-icon-background-color',
            'toggle-icon-hover-background-color',
            'toggle-icon-border-radius',
            'enable-custom-toggle-style',
            'toggle-inherit-icon-style',
        ];

        this._buildUI();
    }

    _buildUI() {
        const page = buildPrefsWidget(this, this._settings, this._settingsKeys);

        this._buildIconGroup(page);
        this._buildPositionGroup(page);
        this._buildCustomStyleSwitch(page);
        this._buildStyleGroups(page);
    }

    _buildIconGroup(page) {
        const group = new Adw.PreferencesGroup({title: _('Icon')});
        page.add(group);

        group.add(createIconPickerRow(
            _('Icon'),
            this._settings,
            'toggle-icon-name',
            this._window,
            IconPickerWidget,
            RECOMMENDED_TOGGLE_ICONS,
            {showCustom: false}
        ));

        group.add(createSpinRow(_('Size (px)'), this._settings, 'toggle-icon-size', 8, 64));
    }

    _buildPositionGroup(page) {
        const group = new Adw.PreferencesGroup({title: _('Position')});
        page.add(group);

        group.add(createComboRow(
            _('Side'),
            _('Relative to the tray icons.'),
            this._settings,
            'toggle-position',
            [_('Left'), _('Right')],
            ['left', 'right']
        ));
    }

    // Placed above the gated style controls so users see it first.
    _buildCustomStyleSwitch(page) {
        const group = new Adw.PreferencesGroup();
        group.add(createSwitchRow(
            _('Custom Style'),
            _('Reveal colors, padding and margin controls below.'),
            this._settings,
            'enable-custom-toggle-style'
        ));
        page.add(group);
    }

    // Each style category lives in its own group so whole sections can be
    // toggled via `visible` based on the master and inherit switches.
    _buildStyleGroups(page) {
        const inheritRow = createSwitchRow(
            _('Inherit Style from Tray Icons'),
            _('Match the look of tray icons; hides the controls below.'),
            this._settings,
            'toggle-inherit-icon-style'
        );
        // Greyed out when tray icons have no custom style. Nothing to inherit from.
        this._settings.bind(
            'enable-custom-icon-style', inheritRow, 'sensitive',
            Gio.SettingsBindFlags.GET
        );

        const inheritGroup = new Adw.PreferencesGroup();
        inheritGroup.add(inheritRow);
        page.add(inheritGroup);

        const radiusGroup = new Adw.PreferencesGroup({title: _('Shape')});
        radiusGroup.add(createSpinRow(_('Corner Radius (px)'), this._settings, 'toggle-icon-border-radius', 0, 50));
        page.add(radiusGroup);

        const colorsGroup = new Adw.PreferencesGroup({title: _('Colors')});
        createIconColorPair(this._window, this._settings, 'toggle-icon-').forEach(r => colorsGroup.add(r));
        page.add(colorsGroup);

        const paddingGroup = createBoxSidesGroup(_('Padding'), this._settings, 'toggle-padding');
        page.add(paddingGroup);

        const marginGroup = createBoxSidesGroup(_('Margin'), this._settings, 'toggle-margin');
        page.add(marginGroup);

        const styleGroups = [inheritGroup, radiusGroup, colorsGroup, paddingGroup, marginGroup];
        const tunableGroups = [radiusGroup, colorsGroup, paddingGroup, marginGroup];

        const sync = () => {
            const customOn = this._settings.get_boolean('enable-custom-toggle-style');
            const inheritOn = customOn && this._settings.get_boolean('toggle-inherit-icon-style');
            styleGroups.forEach(g => {
                g.visible = customOn;
            });
            tunableGroups.forEach(g => {
                g.visible = customOn && !inheritOn;
            });
            inheritGroup.visible = customOn;
        };
        connectScoped(this, this._settings, 'changed::enable-custom-toggle-style', sync);
        connectScoped(this, this._settings, 'changed::toggle-inherit-icon-style', sync);
        sync();
    }
}
