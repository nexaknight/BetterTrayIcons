import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    createSpinRow,
    createSwitchRow,
    buildPrefsWidget,
    createIconColorRows,
    bindGroupsVisible,
    createCustomStyleSwitchGroup,
    createShapeGroup,
    createSpacingGroup,
} from '../widgets/rows.js';
import {createPreviewGroup, buildTrayPreview} from '../widgets/preview.js';
import {spacingLinkKey} from '../widgets/gtkHelpers.js';
import {TRAY_STYLE_KEYS} from '../../const.js';

// Shared between each subpage's reset button and its live preview, so a key
// added to a style can't reset without repainting or the other way around.
// Symbolic icons are not a style key for the shell, but this page owns the
// switch and the preview repaints on it. Same for the two chain toggles,
// they are page values a reset has to restore.
export const TRAY_ICON_STYLE_KEYS = Object.freeze([
    ...TRAY_STYLE_KEYS,
    'enable-symbolic-icons',
    spacingLinkKey('icon-padding'),
    spacingLinkKey('icon-margin'),
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

    // Size and symbolic icons apply even with custom style off (icons.js
    // resolves both unconditionally), so they sit above the switch where
    // they stay reachable. Padding and margin are custom-style-only, same
    // as colors and shape (stock mode keeps its fixed pill padding and 1px
    // margins), so all four sit below with the switch.
    _buildUI() {
        const page = buildPrefsWidget(this, this._settings, TRAY_ICON_STYLE_KEYS,
            {window: this._window});

        page.add(createPreviewGroup(this._settings, {
            watch: TRAY_ICON_STYLE_KEYS,
            render: buildTrayPreview,
        }));

        const groupIcons = new Adw.PreferencesGroup({title: _('Icons')});
        page.add(groupIcons);
        groupIcons.add(createSwitchRow(_('Symbolic Icons'), _('Use monochrome icons when available.'),
            this._settings, 'enable-symbolic-icons'));
        groupIcons.add(createSpinRow(_('Icon Size (px)'), this._settings, 'icon-size', 16, 128, 2));

        page.add(createCustomStyleSwitchGroup(this._settings, 'enable-custom-icon-style'));

        const groupColor = new Adw.PreferencesGroup({title: _('Colors')});
        createIconColorRows(this._window, this._settings, 'icon-').forEach(r => groupColor.add(r));
        page.add(groupColor);

        const spacingGroup = createSpacingGroup(this._settings, 'icon');
        page.add(spacingGroup);

        const groupShape = createShapeGroup(this._settings, 'icon-border-radius', 'icon-border-width');
        page.add(groupShape);

        bindGroupsVisible(this, this._settings, [groupColor, spacingGroup, groupShape],
            () => this._settings.get_boolean('enable-custom-icon-style'), 'enable-custom-icon-style');
    }
}
