import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';

import {
    createSpinRow,
    createSegmentedRow,
    createIconPickerRow,
    createSwitchRow,
    buildPrefsWidget,
    bindGroupsVisible,
    createIconColorRows,
    createSpacingGroup,
    createCustomStyleSwitchGroup,
    createShapeGroup,
    createExpanderSection,
    createDialogGearButton,
    createColorSetRow,
} from '../widgets/rows.js';
import {createPreviewGroup, buildTogglePreview} from '../widgets/preview.js';
import IconPickerDialog from '../dialogs/iconPicker.js';
import ConfigDialog from '../dialogs/configDialog.js';
import {spacingLinkKey} from '../widgets/gtkHelpers.js';
import {TRAY_ICON_STYLE_KEYS} from './trayIcons.js';
import {withLightTwins} from '../../shared/colorVariant.js';

export const TOGGLE_STYLE_KEYS = Object.freeze([
    'toggle-position',
    'toggle-icon-name',
    'toggle-icon-active-name',
    'toggle-icon-rotate',
    'toggle-icon-rotate-angle',
    'toggle-icon-rotate-reverse',
    'toggle-icon-rotate-animate',
    'toggle-icon-rotate-duration',
    'toggle-icon-rotate-delay',
    'toggle-icon-size',
    'toggle-padding-top',
    'toggle-padding-bottom',
    'toggle-padding-left',
    'toggle-padding-right',
    'toggle-margin-top',
    'toggle-margin-bottom',
    'toggle-margin-left',
    'toggle-margin-right',
    ...withLightTwins([
        'toggle-icon-color',
        'toggle-icon-hover-color',
        'toggle-icon-background-color',
        'toggle-icon-hover-background-color',
        'toggle-icon-border-color',
        'toggle-icon-hover-border-color',
    ]),
    'toggle-icon-border-radius',
    'toggle-icon-border-width',
    'toggle-icon-color-split',
    'enable-custom-toggle-style',
    'toggle-inherit-icon-style',
    spacingLinkKey('toggle-padding'),
    spacingLinkKey('toggle-margin'),
]);

const ROTATE_TIMING_STEP_MS = 50;

const ROTATE_ANIMATION_KEYS = ['toggle-icon-rotate', 'toggle-icon-rotate-animate'];

const RECOMMENDED_TOGGLE_ICONS = [
    'view-grid-symbolic',
    'view-app-grid-symbolic',
    'start-here-symbolic',
    'preferences-desktop-apps-symbolic',
    'pan-up-symbolic',
    'pan-end-symbolic',
    'pan-down-symbolic',
    'pan-start-symbolic',
    'go-up-symbolic',
    'go-next-symbolic',
    'go-down-symbolic',
    'go-previous-symbolic',
    'go-top-symbolic',
    'go-bottom-symbolic',
    'orientation-landscape-symbolic',
    'orientation-portrait-right-symbolic',
    'orientation-landscape-inverse-symbolic',
    'orientation-portrait-left-symbolic',
    'applications-other-symbolic',
    'application-menu-symbolic',
    'radio-symbolic',
    'radio-checked-symbolic',
    'software-update-available-symbolic',
    'emoji-symbols-symbolic',
    'weather-clear-symbolic',
    'media-playback-start-symbolic',
    'input-gaming-symbolic',
    'org.gnome.Settings-symbolic',
];

export default class ToggleButtonSubpage extends Adw.NavigationPage {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsToggleButtonSubpage'}, this);
    }

    _init(window, settings) {
        super._init({
            title: _('Toggle Button'),
            tag: 'toggle_button_settings',
        });

        this._window = window;
        this._settings = settings;

        this._buildUI();
    }

    _buildUI() {
        const page = buildPrefsWidget(this, this._settings, TOGGLE_STYLE_KEYS,
            {window: this._window});

        // Inherit mode paints with the tray icon keys, so those repaint too.
        page.add(createPreviewGroup(this._settings, {
            watch: [...TOGGLE_STYLE_KEYS, ...TRAY_ICON_STYLE_KEYS],
            render: buildTogglePreview,
            splitKey: 'toggle-icon-color-split',
        }));

        this._buildIconGroup(page);
        this._buildPositionGroup(page);
        this._buildCustomStyleSwitch(page);
        this._buildStyleGroups(page);
    }

    _buildIconGroup(page) {
        const group = new Adw.PreferencesGroup({title: _('Icon')});
        page.add(group);

        const {expander, setRows} = createExpanderSection({
            title: _('Icon'),
            subtitle: _('One icon per overflow menu state.'),
            headerSuffix: createDialogGearButton(this._window, this._settings,
                ConfigDialog, this._iconDialogData()),
        });

        const openRow = this._createIconRow(_('Menu Open'), 'toggle-icon-active-name');
        this._settings.bind('toggle-icon-rotate', openRow, 'visible',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        setRows([this._createIconRow(_('Menu Closed'), 'toggle-icon-name'), openRow]);
        group.add(expander);

        group.add(createSpinRow(_('Size (px)'), this._settings, 'toggle-icon-size', 8, 64));
    }

    _createIconRow(title, key) {
        return createIconPickerRow(
            title,
            this._settings,
            key,
            this._window,
            IconPickerDialog,
            RECOMMENDED_TOGGLE_ICONS,
            {showCustom: false}
        );
    }

    _iconDialogData() {
        return {
            pageTitle: _('Icon'),
            groups: [{
                configs: [
                    {
                        type: 'switch',
                        title: _('Rotate While Open'),
                        subtitle: _('Turn the icon instead of swapping it for a second one.'),
                        key: 'toggle-icon-rotate',
                    },
                    {
                        type: 'segmented',
                        title: _('Angle'),
                        key: 'toggle-icon-rotate-angle',
                        options: ['90°', '180°', '270°'],
                        values: ['90', '180', '270'],
                        visibleByKey: 'toggle-icon-rotate',
                        negate: {
                            key: 'toggle-icon-rotate-reverse',
                            iconName: 'bti-swap-symbolic',
                            tooltip: _('Reverse the turning direction'),
                        },
                    },
                    {
                        type: 'switch',
                        title: _('Animate Rotation'),
                        subtitle: _('Off turns the icon in one jump.'),
                        key: 'toggle-icon-rotate-animate',
                        visibleByKey: 'toggle-icon-rotate',
                    },
                    {
                        type: 'spin',
                        title: _('Duration (ms)'),
                        key: 'toggle-icon-rotate-duration',
                        step: ROTATE_TIMING_STEP_MS,
                        visibleByKey: ROTATE_ANIMATION_KEYS,
                    },
                    {
                        type: 'spin',
                        title: _('Delay (ms)'),
                        key: 'toggle-icon-rotate-delay',
                        step: ROTATE_TIMING_STEP_MS,
                        visibleByKey: ROTATE_ANIMATION_KEYS,
                    },
                ],
            }],
        };
    }

    _buildPositionGroup(page) {
        const group = new Adw.PreferencesGroup({title: _('Position')});
        page.add(group);

        group.add(createSegmentedRow(
            _('Side'),
            _('Relative to the tray icons.'),
            this._settings,
            'toggle-position',
            [_('Left'), _('Right')],
            ['left', 'right']
        ));
    }

    _buildCustomStyleSwitch(page) {
        page.add(createCustomStyleSwitchGroup(this._settings, 'enable-custom-toggle-style'));
    }

    _buildStyleGroups(page) {
        const inheritGroup = new Adw.PreferencesGroup();
        inheritGroup.add(createSwitchRow(
            _('Inherit Style from Tray Icons'),
            _('Match the look of tray icons; hides the controls below.'),
            this._settings,
            'toggle-inherit-icon-style'
        ));
        page.add(inheritGroup);

        const colorsGroup = new Adw.PreferencesGroup({title: _('Colors')});
        colorsGroup.add(createColorSetRow(this._settings, 'toggle-icon-color-split'));
        createIconColorRows(this._window, this._settings, 'toggle-icon-').forEach(r => colorsGroup.add(r));
        page.add(colorsGroup);

        const spacingGroup = createSpacingGroup(this._settings, 'toggle');
        page.add(spacingGroup);

        const shapeGroup = createShapeGroup(this._settings, 'toggle-icon-border-radius', 'toggle-icon-border-width');
        page.add(shapeGroup);

        const customOn = () => this._settings.get_boolean('enable-custom-toggle-style');
        const canInherit = () => this._settings.get_boolean('enable-custom-icon-style');

        // Tray icons on the default style have nothing to hand down. Leaving
        // inherit on would strand the toggle between two styles it can't reach.
        const dropInheritWithoutSource = () => {
            if (!canInherit())
                this._settings.set_boolean('toggle-inherit-icon-style', false);
        };
        connectScoped(this, this._settings, 'changed::enable-custom-icon-style', dropInheritWithoutSource);
        dropInheritWithoutSource();

        bindGroupsVisible(this, this._settings, [inheritGroup],
            () => customOn() && canInherit(),
            'enable-custom-toggle-style', 'enable-custom-icon-style');
        bindGroupsVisible(this, this._settings,
            [colorsGroup, spacingGroup, shapeGroup],
            () => customOn() && !this._settings.get_boolean('toggle-inherit-icon-style'),
            'enable-custom-toggle-style', 'toggle-inherit-icon-style');
    }
}
