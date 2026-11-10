import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import ToggleButtonSubpage, {TOGGLE_STYLE_KEYS} from '../subpages/toggleButtonSubpage.js';
import OverflowMenuSubpage, {OVERFLOW_STYLE_KEYS} from '../subpages/overflowMenuSubpage.js';
import TrayIconsSubpage, {TRAY_ICON_STYLE_KEYS} from '../subpages/trayIconsSubpage.js';

import {watchKeys} from '../../shared/lifecycle.js';
import {createCardPicker} from '../components/card.js';
import {buildPanelBoxScene} from '../components/scenes/panelScene.js';
import {buildQuickSettingsScene} from '../components/scenes/quickSettingsScene.js';
import {PANEL_DISPLAY_MODES, bindVisibility, createSpinRow, createSubpageRow} from '../components/row.js';
import {createResetButton} from '../components/page.js';

const PLACEMENT_KEYS = Object.freeze(['tray-position', 'tray-order', 'visible-icon-limit']);

const PLACEMENT_SPIN_MAX = 20;

const QUICK_SETTINGS_KEYS = Object.freeze(['qs-menu-style', 'qs-visible-rows']);

const APPEARANCE_RESET_KEYS = Object.freeze([
    ...QUICK_SETTINGS_KEYS,
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
        this._createQuickSettingsGroups();
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
        const cards = createCardPicker({
            title: _('Placement'),
            settings: this._settings,
            key: 'tray-position',
            options: boxes.map(box => ({...box, preview: buildPanelBoxScene(this._settings, box.value)})),
            bleed: true,
        });
        this.add(cards);

        const rowGroup = new Adw.PreferencesGroup();
        this.add(rowGroup);
        [cards, rowGroup].forEach(group => bindVisibility(this._settings, 'display-mode', group, PANEL_DISPLAY_MODES));

        rowGroup.add(createSpinRow({
            title: _('Position in Box'),
            subtitle: _('Order within the chosen box.'),
            settings: this._settings,
            key: 'tray-order',
            min: 0,
            max: PLACEMENT_SPIN_MAX,
        }));

        const visibleRow = createSpinRow({
            title: _('Visible Icons'),
            settings: this._settings,
            key: 'visible-icon-limit',
            min: 0,
            max: PLACEMENT_SPIN_MAX,
        });
        const syncVisibleRow = () => {
            visibleRow.subtitle = this._settings.get_string('display-mode') === 'drawer'
                ? _('How many icons stay in the panel. The rest go to the drawer, at 0 every icon does.')
                : _('How many icons stay in the panel. The rest go to the overflow menu, at 0 every icon does.');
        };
        watchKeys(visibleRow, this._settings, ['display-mode'], syncVisibleRow);
        rowGroup.add(visibleRow);
    }

    _createQuickSettingsGroups() {
        const styles = [
            {value: 'popup', label: _('Side Popup')},
            {value: 'inline', label: _('Inline')},
        ];
        const cards = createCardPicker({
            title: _('Placement'),
            description: _('A side popup opens the menu next to Quick Settings. Inline unfolds it inside the list, right below the item.'),
            settings: this._settings,
            key: 'qs-menu-style',
            options: styles.map(style => ({...style, preview: buildQuickSettingsScene(style.value)})),
            bleed: true,
        });
        this.add(cards);

        // Its own row rather than the classic one rebound, each mode keeps its
        // own key and range.
        const rowGroup = new Adw.PreferencesGroup();
        this.add(rowGroup);
        rowGroup.add(createSpinRow({
            title: _('Visible Icons'),
            subtitle: _('How many tray items the Background Apps list shows before it scrolls.'),
            settings: this._settings,
            key: 'qs-visible-rows',
        }));
        [cards, rowGroup].forEach(group => bindVisibility(this._settings, 'display-mode', group, 'background-apps'));
    }

    _createElementsGroup() {
        const group = new Adw.PreferencesGroup({title: _('Elements')});
        this.add(group);

        const surfaces = [
            [_('Tray Icons'), _('Size, padding, colors'), TrayIconsSubpage, 'bti-grid-symbolic', null],
            [_('Toggle Button'), _('Icon, position, colors'), ToggleButtonSubpage, 'bti-properties-symbolic', PANEL_DISPLAY_MODES],
            [_('Overflow Menu'), _('Background, radius, spacing'), OverflowMenuSubpage, 'bti-other-symbolic', 'popup'],
        ];
        surfaces.forEach(([title, subtitle, SubpageClass, prefixIcon, modes]) => {
            const row = createSubpageRow({
                title,
                subtitle,
                window: this._window,
                SubpageClass,
                settings: this._settings,
                prefixIcon,
            });
            // Quick Settings has no toggle button and draws its own surface,
            // the drawer shows the panel's own.
            if (modes)
                bindVisibility(this._settings, 'display-mode', row, modes);
            group.add(row);
        });
    }
}
