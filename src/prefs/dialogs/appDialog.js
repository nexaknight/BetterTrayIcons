import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {setAppConfigValue, deleteAppConfig, formatAppName} from '../../shared/appConfig.js';
import {resolveIcon} from '../../shared/icon.js';
import {clearIds, removeTimer} from '../../shared/lifecycle.js';
import {createButton, createIconButton, createImage, createAdjustment, applyResolvedIcon} from '../widgets/gtkHelpers.js';
import IconPickerWidget from '../widgets/iconPicker.js';
import {ENTRY_DEBOUNCE_MS} from '../../const.js';

export default class AppDialog extends Adw.PreferencesDialog {
    static {
        GObject.registerClass(this);
    }

    _init(settings, appId, appData) {
        super._init({
            title: appData.custom_title || formatAppName(appData.title || appId) || _('App Settings'),
            content_width: 540,
            content_height: 640,
            search_enabled: false,
        });

        this._settings = settings;
        this._appId = appId;
        this._data = appData;
        this._debounceId = 0;
        this._suppressNameNotify = false;

        this._buildUI();
    }

    _buildUI() {
        const page = new Adw.PreferencesPage();
        this.add(page);

        // Wine/Proton tray pixels come from the X11 client via XEmbed.
        // No way to substitute them from our side.
        if (this._data.is_wine || this._data.is_proton) {
            const flavor = this._data.is_proton ? _('Proton') : _('Wine');
            const noticeGroup = new Adw.PreferencesGroup();
            noticeGroup.add(new Adw.Banner({
                title: `${flavor}: ${_('Tray icons are drawn by the app itself via XEmbed, so a custom icon cannot be applied.')}`,
                revealed: true,
            }));
            page.add(noticeGroup);
        }

        const defaultName = formatAppName(this._data.title || this._appId);

        const group = new Adw.PreferencesGroup({
            title: _('Configuration'),
            description: `${_('ID')}: ${this._appId}`,
        });
        page.add(group);

        const nameRow = new Adw.EntryRow({
            title: _('Name'),
            text: this._data.custom_title || defaultName || '',
            show_apply_button: false,
        });

        const resetNameBtn = createIconButton('edit-undo-symbolic', {
            tooltip_text: _('Reset name'),
            visible: !!this._data.custom_title,
        });

        resetNameBtn.connect('clicked', () => {
            this._updateValue('custom_title', null);
            // Suppress the debounced write that notify::text would otherwise
            // schedule. Without this, the field value gets re-persisted as a
            // custom_title and undoes the reset.
            this._suppressNameNotify = true;
            nameRow.text = defaultName;
            this._suppressNameNotify = false;
            clearIds(this, removeTimer, '_debounceId');
            resetNameBtn.visible = false;
        });

        nameRow.add_suffix(resetNameBtn);

        nameRow.connect('notify::text', () => {
            if (this._suppressNameNotify)
                return;
            clearIds(this, removeTimer, '_debounceId');
            this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ENTRY_DEBOUNCE_MS, () => {
                this._updateValue('custom_title', nameRow.text);
                this._debounceId = 0;
                return GLib.SOURCE_REMOVE;
            });
            resetNameBtn.visible = true;
        });
        group.add(nameRow);

        const hideRow = new Adw.SwitchRow({
            title: _('Hide Icon'),
            subtitle: _('Don’t show this icon in the tray.'),
            active: this._data.is_hidden === true,
        });

        hideRow.connect('notify::active', () => {
            this._updateValue('is_hidden', hideRow.active);
        });
        group.add(hideRow);

        const priorityRow = new Adw.SpinRow({
            title: _('Order'),
            subtitle: _('Higher values move the icon further left.'),
            adjustment: createAdjustment({
                lower: -100,
                upper: 100,
                step_increment: 1,
                value: this._data.priority || 0,
            }),
        });

        priorityRow.connect('notify::value', () => {
            this._updateValue('priority', priorityRow.value);
        });
        group.add(priorityRow);

        if (!(this._data.is_wine || this._data.is_proton))
            group.add(this._buildCustomIconRow());

        const dangerGroup = new Adw.PreferencesGroup({title: _('Danger Zone')});
        page.add(dangerGroup);

        const deleteRow = new Adw.ActionRow({
            title: _('Forget App'),
            subtitle: _('Deletes all stored settings for this app.'),
        });

        const deleteBtn = createButton({
            label: _('Forget'),
            cssClasses: ['destructive-action'],
            valign: 'center',
        });

        deleteBtn.connect('clicked', () => {
            deleteAppConfig(this._settings, this._appId);
            this.close();
        });

        deleteRow.add_suffix(deleteBtn);
        dangerGroup.add(deleteRow);
    }

    _buildCustomIconRow() {
        const iconResult = resolveIcon(this._data);

        const iconRow = new Adw.ActionRow({
            title: _('Custom Icon'),
            subtitle: this._data.custom_icon ? this._data.custom_icon : _('Default app icon'),
            activatable: true,
        });

        const iconImage = createImage({pixel_size: 24});
        this._updateIconPreview(iconImage, iconResult);
        iconRow.add_prefix(iconImage);

        const resetBtn = createIconButton('edit-undo-symbolic', {
            tooltip_text: _('Reset icon'),
            visible: !!this._data.custom_icon,
        });

        resetBtn.connect('clicked', () => {
            this._updateValue('custom_icon', null);
            const newResult = resolveIcon(this._data);
            iconRow.set_subtitle(_('Default app icon'));
            this._updateIconPreview(iconImage, newResult);
            resetBtn.visible = false;
        });

        iconRow.add_suffix(resetBtn);
        iconRow.add_suffix(createImage({icon_name: 'go-next-symbolic'}));

        iconRow.connect('activated', () => {
            const currentIconForPicker = this._data.custom_icon || this._data.detected_icon || null;

            const picker = new IconPickerWidget(
                this._settings,
                null,
                [],
                selectedIcon => {
                    this._updateValue('custom_icon', selectedIcon);
                    const newResult = resolveIcon(this._data);
                    iconRow.set_subtitle(selectedIcon);
                    this._updateIconPreview(iconImage, newResult);
                    resetBtn.visible = true;
                },
                currentIconForPicker
            );

            picker.present(this);
        });
        return iconRow;
    }

    // Update the local cache first so the UI doesn't lag behind the
    // GSettings write.
    _updateValue(key, value) {
        if (value === null || value === undefined)
            delete this._data[key];
        else
            this._data[key] = value;

        setAppConfigValue(this._settings, this._appId, key, value);
    }

    _updateIconPreview(imageWidget, iconResult) {
        const useSymbolic = this._settings.get_boolean('enable-symbolic-icons');
        applyResolvedIcon(imageWidget, iconResult, useSymbolic);
    }

    vfunc_dispose() {
        clearIds(this, removeTimer, '_debounceId');
        super.vfunc_dispose();
    }
}
