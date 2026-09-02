import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import ToggleButtonSubpage, {TOGGLE_STYLE_KEYS} from '../subpages/toggleButtonSubpage.js';
import OverflowMenuSubpage, {OVERFLOW_STYLE_KEYS} from '../subpages/overflowMenuSubpage.js';
import TrayIconsSubpage, {TRAY_ICON_STYLE_KEYS} from '../subpages/trayIconsSubpage.js';

import {createCardPicker} from '../components/card.js';
import {buildPanelBoxScene} from '../components/scenes/panelScene.js';
import {createSpinRow, createSubpageRow} from '../components/row.js';
import {createResetButton} from '../components/page.js';

const PLACEMENT_KEYS = Object.freeze(['tray-position', 'tray-order', 'visible-icon-limit']);

const APPEARANCE_RESET_KEYS = Object.freeze([
    ...PLACEMENT_KEYS,
    ...TRAY_ICON_STYLE_KEYS,
    ...TOGGLE_STYLE_KEYS,
    ...OVERFLOW_STYLE_KEYS,
]);

export class AppearancePage extends Adw.PreferencesPage {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsAppearancePage'}, this);
    }

    _init(window, settings) {
        super._init({
            title: _('Appearance'),
            icon_name: 'bti-color-symbolic',
        });

        this._window = window;
        this._settings = settings;
        this._headerActions = null;

        this._createPlacementGroups();
        this._createElementsGroup();
    }

    get headerActions() {
        this._headerActions ??= createResetButton({
            settings: this._settings,
            keys: APPEARANCE_RESET_KEYS,
            window: this._window,
            includesSubpages: true,
        });
        return this._headerActions;
    }

    _createPlacementGroups() {
        const boxes = [
            {value: 'left', label: _('Left')},
            {value: 'center', label: _('Center')},
            {value: 'right', label: _('Right')},
        ];
        this.add(createCardPicker({
            title: _('Placement'),
            description: _('Which part of the panel holds the icons.'),
            settings: this._settings,
            key: 'tray-position',
            options: boxes.map(box => ({...box, preview: buildPanelBoxScene(this._settings, box.value)})),
            bleed: true,
        }));

        const rows = new Adw.PreferencesGroup();
        this.add(rows);

        rows.add(createSpinRow({
            title: _('Position in Box'),
            subtitle: _('Order within the chosen box.'),
            settings: this._settings,
            key: 'tray-order',
            min: 0,
            max: 20,
        }));

        rows.add(createSpinRow({
            title: _('Visible Icons'),
            subtitle: _('How many icons stay in the panel. Extra icons move to the overflow menu, and 0 moves them all.'),
            settings: this._settings,
            key: 'visible-icon-limit',
            min: 0,
            max: 20,
        }));
    }

    _createElementsGroup() {
        const group = new Adw.PreferencesGroup({title: _('Elements')});
        this.add(group);

        const surfaces = [
            [_('Tray Icons'), _('Size, padding, colors'), TrayIconsSubpage, 'bti-grid-symbolic'],
            [_('Toggle Button'), _('Icon, position, colors'), ToggleButtonSubpage, 'bti-properties-symbolic'],
            [_('Overflow Menu'), _('Background, radius, spacing'), OverflowMenuSubpage, 'bti-other-symbolic'],
        ];
        surfaces.forEach(([title, subtitle, SubpageClass, prefixIcon]) => {
            group.add(createSubpageRow({
                title,
                subtitle,
                window: this._window,
                SubpageClass,
                settings: this._settings,
                prefixIcon,
            }));
        });
    }
}
