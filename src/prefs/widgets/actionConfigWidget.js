import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';
import {createIconButton} from './gtkHelpers.js';
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
            if (this._data.configs) {
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

        if (Array.isArray(this._data.configs)) {
            this._data.configs.forEach(conf => {
                const row = this._createRow(conf);
                if (row)
                    group.add(row);
            });
        }

        this._addDoubleClickBanner(toolbarView);
    }

    _createRow(conf) {
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
        case 'entry':
            return createEntryRow(conf.title, this._settings, conf.key);
        default:
            return null;
        }
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

        const update = () => {
            const v = this._settings.get_string(doubleCfg.key);
            banner.revealed = !!v && v !== 'nothing';
        };

        connectScoped(this, this._settings, `changed::${doubleCfg.key}`, update, 'closed');
        update();
    }
}
