import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PANEL_DISPLAY_MODES, createRangeRow, createSwitchRow, createIconColorRows, bindGroupsVisible, bindVisibility, createColorSetRow} from '../components/row.js';
import {buildPrefsWidget} from '../components/page.js';
import {createCustomStyleSwitchGroup, createShapeGroup, createSpacingGroup} from '../components/group.js';
import {createPreviewGroup} from '../components/preview.js';
import {buildTrayPreview} from '../components/scenes/trayScene.js';
import {spacingLinkKey} from '../components/spacing.js';
import {ICON_SIZE_RANGE_PX, TRAY_STYLE_KEYS} from '../../const.js';

// Shared between the reset button and the live preview, so a key added to a
// style can't reset without repainting or the other way around. The symbolic
// switch and the chain toggles are page values, both consumers still need them.
export const TRAY_ICON_STYLE_KEYS = Object.freeze([
    ...TRAY_STYLE_KEYS,
    'enable-symbolic-icons',
    spacingLinkKey('icon-padding'),
    spacingLinkKey('icon-margin'),
    'icon-blur',
]);

export default class TrayIconsSubpage extends Adw.NavigationPage {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsTrayIconsSubpage'}, this);
    }

    _init(window, settings) {
        super._init({
            title: _('Tray Icons'),
            tag: 'tray_icons_settings',
        });

        this._window = window;
        this._settings = settings;

        this._buildUI();
    }

    _buildUI() {
        const page = buildPrefsWidget(this, this._settings, TRAY_ICON_STYLE_KEYS,
            {window: this._window});

        const previewGroup = createPreviewGroup({
            settings: this._settings,
            watch: TRAY_ICON_STYLE_KEYS,
            render: buildTrayPreview,
            splitKey: 'icon-color-split',
        });
        page.add(previewGroup);

        const iconsGroup = new Adw.PreferencesGroup({title: _('Icons')});
        page.add(iconsGroup);
        iconsGroup.add(createSwitchRow({
            title: _('Symbolic Icons'),
            subtitle: _('Use monochrome icons when available.'),
            settings: this._settings,
            key: 'enable-symbolic-icons',
        }));
        iconsGroup.add(createRangeRow({
            title: _('Icon Size (px)'),
            settings: this._settings,
            key: 'icon-size',
            ...ICON_SIZE_RANGE_PX,
        }));

        const isPanelMode = () => PANEL_DISPLAY_MODES.includes(this._settings.get_string('display-mode'));
        // Quick Settings paints an opaque menu, a blur behind the rows has
        // nothing to blur
        const customStyleGroup = createCustomStyleSwitchGroup({
            settings: this._settings,
            key: 'enable-custom-icon-style',
            blurKey: 'icon-blur',
            blurVisible: {keys: ['display-mode'], test: isPanelMode},
        });
        page.add(customStyleGroup);

        const colorGroup = new Adw.PreferencesGroup({title: _('Colors')});
        colorGroup.add(createColorSetRow({settings: this._settings, splitKey: 'icon-color-split'}));
        const [iconRow, ...boxColorRows] = createIconColorRows({parent: this._window, settings: this._settings, keyPrefix: 'icon-'});
        [iconRow, ...boxColorRows].forEach(row => colorGroup.add(row));
        page.add(colorGroup);

        const spacingGroup = createSpacingGroup({settings: this._settings, keyBase: 'icon'});
        page.add(spacingGroup);

        const shapeGroup = createShapeGroup({
            settings: this._settings,
            radiusKey: 'icon-border-radius',
            borderWidthKey: 'icon-border-width',
        });
        page.add(shapeGroup);

        bindGroupsVisible(this, this._settings, [colorGroup],
            () => this._settings.get_boolean('enable-custom-icon-style'), 'enable-custom-icon-style');

        // Quick Settings rows take the menu item style, only the icon tint
        // carries over, so the box controls and their guides go.
        bindGroupsVisible(this, this._settings, [spacingGroup, shapeGroup],
            () => this._settings.get_boolean('enable-custom-icon-style') && isPanelMode(),
            'enable-custom-icon-style', 'display-mode');
        [previewGroup.header_suffix, ...boxColorRows].forEach(widget =>
            bindVisibility(this._settings, 'display-mode', widget, PANEL_DISPLAY_MODES));
    }
}
