import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';

import {createSpinRow, createSegmentedRow, createIconPickerRow, createSwitchRow, bindGroupsVisible, createIconColorRows, createExpanderSection, createColorSetRow} from '../components/row.js';
import {buildPrefsWidget} from '../components/page.js';
import {createSpacingGroup, createCustomStyleSwitchGroup, createShapeGroup} from '../components/group.js';
import {createDialogGearButton} from '../components/button.js';
import {createPreviewGroup} from '../components/preview.js';
import {buildTogglePreview} from '../components/scenes/toggleScene.js';
import IconPickerDialog from '../components/picker.js';
import ConfigDialog from '../dialogs/configDialog.js';
import {spacingLinkKey} from '../components/spacing.js';
import {TRAY_ICON_STYLE_KEYS} from './trayIconsSubpage.js';
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

const TOGGLE_ICON_SIZE_MIN_PX = 8;
const TOGGLE_ICON_SIZE_MAX_PX = 64;

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
        page.add(createPreviewGroup({
            settings: this._settings,
            watch: [...TOGGLE_STYLE_KEYS, ...TRAY_ICON_STYLE_KEYS],
            render: buildTogglePreview,
            splitKey: 'toggle-icon-color-split',
        }));

        this._buildIconGroup(page);
        this._buildPositionGroup(page);
        page.add(createCustomStyleSwitchGroup({
            settings: this._settings,
            key: 'enable-custom-toggle-style',
        }));
        this._buildStyleGroups(page);
    }

    _buildIconGroup(page) {
        const group = new Adw.PreferencesGroup({title: _('Icon')});
        page.add(group);

        const {expander, setRows} = createExpanderSection({
            title: _('Icon'),
            subtitle: _('One icon per overflow menu state.'),
            headerSuffix: createDialogGearButton({
                window: this._window,
                settings: this._settings,
                DialogClass: ConfigDialog,
                dialogData: this._iconDialogData(),
            }),
        });

        const openRow = this._createIconRow(_('Menu Open'), 'toggle-icon-active-name');
        this._settings.bind('toggle-icon-rotate', openRow, 'visible',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        setRows([this._createIconRow(_('Menu Closed'), 'toggle-icon-name'), openRow]);
        group.add(expander);

        group.add(createSpinRow({
            title: _('Size (px)'),
            settings: this._settings,
            key: 'toggle-icon-size',
            min: TOGGLE_ICON_SIZE_MIN_PX,
            max: TOGGLE_ICON_SIZE_MAX_PX,
        }));
    }

    _createIconRow(title, key) {
        return createIconPickerRow({
            title,
            settings: this._settings,
            key,
            window: this._window,
            PickerClass: IconPickerDialog,
            icons: RECOMMENDED_TOGGLE_ICONS,
            showCustom: false,
        });
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

        group.add(createSegmentedRow({
            title: _('Side'),
            subtitle: _('Relative to the tray icons.'),
            settings: this._settings,
            key: 'toggle-position',
            options: [_('Left'), _('Right')],
            values: ['left', 'right'],
        }));
    }

    _buildStyleGroups(page) {
        const inheritGroup = new Adw.PreferencesGroup();
        inheritGroup.add(createSwitchRow({
            title: _('Inherit Style from Tray Icons'),
            subtitle: _('Match the look of tray icons. Hides the controls below.'),
            settings: this._settings,
            key: 'toggle-inherit-icon-style',
        }));
        page.add(inheritGroup);

        const colorsGroup = new Adw.PreferencesGroup({title: _('Colors')});
        colorsGroup.add(createColorSetRow({
            settings: this._settings,
            splitKey: 'toggle-icon-color-split',
        }));
        createIconColorRows({parent: this._window, settings: this._settings, keyPrefix: 'toggle-icon-'})
            .forEach(row => colorsGroup.add(row));
        page.add(colorsGroup);

        const spacingGroup = createSpacingGroup({settings: this._settings, keyBase: 'toggle'});
        page.add(spacingGroup);

        const shapeGroup = createShapeGroup({
            settings: this._settings,
            radiusKey: 'toggle-icon-border-radius',
            borderWidthKey: 'toggle-icon-border-width',
        });
        page.add(shapeGroup);

        const isCustomStyleOn = () => this._settings.get_boolean('enable-custom-toggle-style');
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
            () => isCustomStyleOn() && canInherit(),
            'enable-custom-toggle-style', 'enable-custom-icon-style');
        bindGroupsVisible(this, this._settings,
            [colorsGroup, spacingGroup, shapeGroup],
            () => isCustomStyleOn() && !this._settings.get_boolean('toggle-inherit-icon-style'),
            'enable-custom-toggle-style', 'toggle-inherit-icon-style');
    }
}
