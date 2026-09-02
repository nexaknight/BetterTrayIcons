import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {createAccentColorRow, createSpinRow, bindVisibility, bindGroupsVisible, createColorSetRow} from '../components/row.js';
import {buildPrefsWidget} from '../components/page.js';
import {createSpacingGroup, createCustomStyleSwitchGroup, createShapeGroup} from '../components/group.js';
import {spacingLinkKey} from '../components/spacing.js';
import {createCardPicker} from '../components/card.js';
import {createPreviewGroup, PREVIEW_STAGE_HEIGHT_PX} from '../components/preview.js';
import {buildLayoutThumbnail} from '../components/scenes/layoutScene.js';
import {buildOverflowPreview} from '../components/scenes/overflowScene.js';
import {TRAY_ICON_STYLE_KEYS} from './trayIconsSubpage.js';
import {withLightTwins} from '../../shared/colorVariant.js';

const GRID_COLUMNS_MIN = 1;
const GRID_COLUMNS_MAX = 10;

export const OVERFLOW_STYLE_KEYS = Object.freeze([
    'overflow-layout-mode',
    'grid-column-limit',
    'overflow-container-padding-top',
    'overflow-container-padding-bottom',
    'overflow-container-padding-left',
    'overflow-container-padding-right',
    'overflow-container-margin-top',
    'overflow-container-margin-bottom',
    'overflow-container-margin-left',
    'overflow-container-margin-right',
    ...withLightTwins(['overflow-container-background-color', 'overflow-container-border-color']),
    'overflow-container-border-radius',
    'overflow-container-border-width',
    'overflow-container-color-split',
    'enable-custom-overflow-style',
    spacingLinkKey('overflow-container-padding'),
    spacingLinkKey('overflow-container-margin'),
]);

export default class OverflowMenuSubpage extends Adw.NavigationPage {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsOverflowMenuSubpage'}, this);
    }

    _init(window, settings) {
        super._init({
            title: _('Overflow Container'),
            tag: 'overflow_menu_settings',
        });

        this._window = window;
        this._settings = settings;

        this._buildUI();
    }

    _buildUI() {
        const contentPage = buildPrefsWidget(this, this._settings, OVERFLOW_STYLE_KEYS,
            {window: this._window});

        // The popup renders tray icons, so their styling repaints it too.
        contentPage.add(createPreviewGroup({
            settings: this._settings,
            watch: [...OVERFLOW_STYLE_KEYS, ...TRAY_ICON_STYLE_KEYS],
            render: buildOverflowPreview,
            splitKey: 'overflow-container-color-split',
            stageHeight: PREVIEW_STAGE_HEIGHT_PX.popup,
        }));

        contentPage.add(createCardPicker({
            title: _('Overflow Layout'),
            settings: this._settings,
            key: 'overflow-layout-mode',
            options: [
                {value: 'row', label: _('Row'), preview: buildLayoutThumbnail('row')},
                {value: 'grid', label: _('Grid'), preview: buildLayoutThumbnail('grid')},
            ],
        }));

        const columnsGroup = new Adw.PreferencesGroup();
        columnsGroup.add(createSpinRow({
            title: _('Grid Columns'),
            settings: this._settings,
            key: 'grid-column-limit',
            min: GRID_COLUMNS_MIN,
            max: GRID_COLUMNS_MAX,
        }));
        contentPage.add(columnsGroup);
        bindVisibility(this._settings, 'overflow-layout-mode', columnsGroup, 'grid');

        contentPage.add(createCustomStyleSwitchGroup({
            settings: this._settings,
            key: 'enable-custom-overflow-style',
        }));

        const colorGroup = new Adw.PreferencesGroup({title: _('Colors')});
        colorGroup.add(createColorSetRow({
            settings: this._settings,
            splitKey: 'overflow-container-color-split',
        }));
        colorGroup.add(createAccentColorRow({
            parent: this._window,
            settings: this._settings,
            title: _('Background'),
            key: 'overflow-container-background-color',
            variantTitle: _('Background Color'),
        }));
        colorGroup.add(createAccentColorRow({
            parent: this._window,
            settings: this._settings,
            title: _('Border'),
            key: 'overflow-container-border-color',
            variantTitle: _('Border Color'),
        }));
        contentPage.add(colorGroup);

        const spacingGroup = createSpacingGroup({settings: this._settings, keyBase: 'overflow-container'});
        contentPage.add(spacingGroup);

        const shapeGroup = createShapeGroup({
            settings: this._settings,
            radiusKey: 'overflow-container-border-radius',
            borderWidthKey: 'overflow-container-border-width',
        });
        contentPage.add(shapeGroup);

        bindGroupsVisible(this, this._settings, [colorGroup, spacingGroup, shapeGroup],
            () => this._settings.get_boolean('enable-custom-overflow-style'), 'enable-custom-overflow-style');
    }
}
