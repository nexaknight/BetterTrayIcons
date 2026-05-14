import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getAppConfigValue, setAppConfigValue, removeAppConfigKey} from '../../shared/appConfig.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {createIconButton, createAdjustment, createStringList} from './gtkHelpers.js';
import {
    createComboRow, createSpinRow, createSwitchRow, createColorRow, createEntryRow,
} from './rows.js';

export default class ActionConfigWidget extends Adw.Dialog {
    static {
        GObject.registerClass(this);
    }

    _init(parentWindow, settings, data) {
        super._init({
            content_width: 500,
            content_height: 600,
            title: data.pageTitle || _('Configuration'),
        });

        this._settings = settings;
        this._data = data;
        this._isAppMode = !!data.appId;

        this._buildUI();
    }

    _buildUI() {
        const toolbarView = new Adw.ToolbarView();
        this.set_child(toolbarView);

        const headerBar = new Adw.HeaderBar();
        toolbarView.add_top_bar(headerBar);

        const resetBtn = createIconButton('edit-undo-symbolic', {
            circular: false,
            tooltip_text: _('Reset'),
        });

        resetBtn.connect('clicked', () => {
            if (this._isAppMode) {
                if (this._data.configs) {
                    this._data.configs.forEach(conf => {
                        removeAppConfigKey(this._settings, this._data.appId, conf.key);
                    });
                }
                this.close();
            } else if (this._data.configs) {
                this._data.configs.forEach(conf => {
                    if (conf.key)
                        this._settings.reset(conf.key);
                });
            }
        });
        headerBar.pack_end(resetBtn);

        const contentPage = new Adw.PreferencesPage();
        toolbarView.set_content(contentPage);

        const group = new Adw.PreferencesGroup({
            title: this._data.groupTitle || _('Settings'),
            description: this._data.description || '',
        });
        contentPage.add(group);

        if (this._data.configs && Array.isArray(this._data.configs)) {
            this._data.configs.forEach(conf => {
                const row = this._isAppMode
                    ? this._createAppModeRow(conf)
                    : this._createStandardModeRow(conf);
                if (row)
                    group.add(row);
            });
        }

        this._addDoubleClickBanner(toolbarView);
    }

    // Reveal an info banner whenever the dialog's `*-double` config is non-default.
    // Explains the single-click delay that comes with it.
    _addDoubleClickBanner(toolbarView) {
        const doubleCfg = (this._data.configs || []).find(c => c.key && c.key.endsWith('-double'));
        if (!doubleCfg)
            return;

        const banner = new Adw.Banner({
            title: _('Single clicks are briefly delayed while a double-click action is set, so the second click can be detected.'),
        });
        toolbarView.add_top_bar(banner);

        const readValue = () => this._isAppMode
            ? getAppConfigValue(this._settings, this._data.appId, doubleCfg.key, null)
            : this._settings.get_string(doubleCfg.key);

        const update = () => {
            const v = readValue();
            banner.revealed = !!v && v !== 'nothing';
        };

        const signal = this._isAppMode
            ? 'changed::app-configs'
            : `changed::${doubleCfg.key}`;
        connectScoped(this, this._settings, signal, update, 'closed');
        update();
    }

    _createAppModeRow(conf) {
        let row;
        const currentVal = getAppConfigValue(this._settings, this._data.appId, conf.key, null);

        switch (conf.type) {
        case 'switch':
            row = new Adw.SwitchRow({
                title: conf.title, subtitle: conf.subtitle || '',
                active: currentVal === true,
            });
            row.connect('notify::active', () => {
                setAppConfigValue(this._settings, this._data.appId, conf.key, row.active);
            });
            break;

        case 'spin':
            row = new Adw.SpinRow({
                title: conf.title, subtitle: conf.subtitle || '',
                adjustment: createAdjustment({
                    lower: conf.min || 0, upper: conf.max || 100, step_increment: conf.step || 1,
                    value: typeof currentVal === 'number' ? currentVal : conf.default || 0,
                }),
            });
            row.connect('notify::value', () => {
                setAppConfigValue(this._settings, this._data.appId, conf.key, row.value);
            });
            break;

        case 'entry':
            row = new Adw.EntryRow({
                title: conf.title, text: currentVal || '', show_apply_button: true,
            });
            row.connect('apply', () => {
                setAppConfigValue(this._settings, this._data.appId, conf.key, row.text);
            });
            break;

        case 'combo':
            row = new Adw.ComboRow({
                title: conf.title, subtitle: conf.subtitle || '',
                model: createStringList(conf.options),
            });
            if (currentVal && conf.values && conf.values.includes(currentVal))
                row.set_selected(conf.values.indexOf(currentVal));

            row.connect('notify::selected', () => {
                if (conf.values)
                    setAppConfigValue(this._settings, this._data.appId, conf.key, conf.values[row.selected]);
            });
            break;
        }
        return row;
    }

    _createStandardModeRow(conf) {
        switch (conf.type) {
        case 'combo':
            return createComboRow(conf.title, conf.subtitle, this._settings, conf.key, conf.options, conf.values, {
                experimentalValues: conf.experimentalValues,
            });
        case 'spin':
            return createSpinRow(conf.title, this._settings, conf.key, conf.min || 0, conf.max || 100, conf.step || 1);
        case 'switch':
            return createSwitchRow(conf.title, conf.subtitle, this._settings, conf.key);
        case 'color':
            return createColorRow(conf.title, this._settings, conf.key);
        case 'entry': {
            return createEntryRow(conf.title, this._settings, conf.key);
        }
        default:
            return null;
        }
    }
}
