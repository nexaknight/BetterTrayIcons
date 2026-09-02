import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';
import {buildPrefsWidget} from '../components/page.js';
import {addConfigRows} from '../components/row.js';
import {createCappedBanner, pinDialogWidth} from '../components/dialog.js';

const CONFIG_DIALOG_WIDTH_PX = 500;

export default class ConfigDialog extends Adw.Dialog {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsConfigDialog'}, this);
    }

    _init(_parentWindow, settings, data) {
        super._init({
            follows_content_size: true,
            title: data.pageTitle,
        });

        this._settings = settings;
        this._data = data;

        this._buildUI();
        pinDialogWidth(this, CONFIG_DIALOG_WIDTH_PX);
    }

    _buildUI() {
        const contentPage = buildPrefsWidget(this, this._settings,
            this._configs().map(c => c.key));

        this._data.groups.forEach(({title, configs}) => {
            const group = new Adw.PreferencesGroup({title: title ?? ''});
            contentPage.add(group);
            addConfigRows(group, this._settings, configs);
        });

        this._addDoubleClickBanner(this.get_child());
    }

    _configs() {
        return this._data.groups.flatMap(g => g.configs);
    }

    _addDoubleClickBanner(toolbarView) {
        const doubleKeys = this._configs()
            .map(c => c.key)
            .filter(key => key.endsWith('-double'));
        if (doubleKeys.length === 0)
            return;

        const banner = createCappedBanner(
            _('Single clicks are briefly delayed while a double-click action is set, so the second click can be detected.'));
        toolbarView.add_top_bar(banner);

        const update = () => {
            banner.revealed = doubleKeys.some(key => {
                const value = this._settings.get_string(key);
                return !!value && value !== 'nothing';
            });
        };

        doubleKeys.forEach(key =>
            connectScoped(this, this._settings, `changed::${key}`, update, 'closed'));
        update();
    }
}
