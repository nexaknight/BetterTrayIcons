import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {setAppConfigValue, deleteAppConfig, displayAppName, formatAppName, orderedAppIds, readVisibleOrder, setAppPriorities, getAppConfigMap} from '../../shared/appConfig.js';
import {resolveIcon, themeProbeKey} from '../../shared/iconLoading.js';
import {clearIds, connectScoped, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {createButton, createIconButton} from '../components/button.js';
import {createImage} from '../components/image.js';
import {createCappedBanner, ENTRY_DEBOUNCE_MS, pinDialogWidth, showConfirmationDialog} from '../components/dialog.js';
import {applyIconPreview, hasThemeIcon, NEXT_ICON_NAME} from '../components/icon.js';
import {createActionRow} from '../components/row.js';
import {buildPrefsWidget} from '../components/page.js';
import IconPickerDialog from '../components/picker.js';
import StatusBadgeDialog from './statusBadgeDialog.js';

const APP_DIALOG_WIDTH_PX = 540;
const ICON_PREVIEW_SIZE_PX = 24;

export default class AppDialog extends Adw.Dialog {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsAppDialog'}, this);
    }

    _init(settings, appId, appData, iconPaths, {onForget}) {
        super._init({
            title: displayAppName(appData, appId) || _('App Settings'),
            follows_content_size: true,
        });

        this._settings = settings;
        this._appId = appId;
        this._data = appData;
        this._iconPaths = iconPaths;
        this._onForget = onForget;
        this._debounceId = 0;
        this._suppressNameNotify = false;
        this._suppressPositionNotify = false;

        this._buildUI();
        pinDialogWidth(this, APP_DIALOG_WIDTH_PX);
    }

    _buildUI() {
        const page = buildPrefsWidget(this, this._settings, []);

        // The shell records a state icon the moment an app first shows it, so
        // the snapshot this dialog opened with goes stale while it is open and
        // the new state would only appear after closing and reopening.
        connectScoped(this, this._settings, 'changed::app-configs',
            () => this._refreshFromBlob(), 'closed');

        if (this._data.is_wine || this._data.is_proton) {
            const flavor = this._data.is_proton ? _('Proton') : _('Wine');
            const noticeGroup = new Adw.PreferencesGroup();
            noticeGroup.add(createCappedBanner(
                `${flavor}: ${_('Tray icons are drawn by the app itself via XEmbed, so a custom icon cannot be applied.')}`,
                {revealed: true}));
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
            text: this._data.custom_title || defaultName,
            show_apply_button: false,
        });

        const resetNameButton = createIconButton('bti-reset-symbolic', {
            tooltip: _('Reset name'),
            visible: !!this._data.custom_title,
        });

        resetNameButton.connect('clicked', () => {
            this._updateValue('custom_title', null);
            // Without this, notify::text schedules a debounced write that
            // re-persists the field as a custom_title and undoes the reset.
            this._suppressNameNotify = true;
            nameRow.text = defaultName;
            this._suppressNameNotify = false;
            clearIds(this, removeTimer, '_debounceId');
            resetNameButton.visible = false;
        });

        nameRow.add_suffix(resetNameButton);

        this._nameRow = nameRow;
        nameRow.connect('notify::text', () => {
            if (this._suppressNameNotify)
                return;
            debounceTo(this, '_debounceId', ENTRY_DEBOUNCE_MS, () => this._updateValue('custom_title', nameRow.text));
            resetNameButton.visible = true;
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

        group.add(this._buildPositionRow());

        if (!(this._data.is_wine || this._data.is_proton)) {
            group.add(this._buildCustomIconRow());
            // States and badges come from SNI and LauncherEntry, and an XEmbed
            // item has neither the properties nor a resolvable desktop id, so
            // the whole dialog would be dead for it.
            if (!this._data.is_xembed) {
                this._statusBadgeRow = this._buildStatusBadgeRow();
                this._statusBadgeRow.visible = !!this._data.custom_icon;
                group.add(this._statusBadgeRow);
            }
        }

        const dangerGroup = new Adw.PreferencesGroup({title: _('Danger Zone')});
        page.add(dangerGroup);

        const deleteButton = createButton({
            label: _('Forget'),
            cssClasses: ['destructive-action'],
            valign: 'center',
        });

        deleteButton.connect('clicked', () => {
            showConfirmationDialog(this, {
                title: _('Forget this app?'),
                message: _('Deletes all stored settings for this app.'),
                confirmLabel: _('Forget'),
                destructive: true,
                onConfirm: () => {
                    // close() disposes only later, so a pending name write
                    // would land after the delete and bring the entry back.
                    clearIds(this, removeTimer, '_debounceId');
                    deleteAppConfig(this._settings, this._appId);
                    this.close();
                    this._onForget();
                },
            });
        });

        dangerGroup.add(createActionRow({
            title: _('Forget App'),
            subtitle: _('Deletes all stored settings for this app.'),
            suffixWidgets: [deleteButton],
        }));
    }

    // Goes through setAppPriorities like drag and scroll do. Writing a raw
    // priority instead would take PRIORITY_STEP clicks to move one slot.
    _buildPositionRow() {
        this._positionRow = new Adw.SpinRow({
            title: _('Position'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 1, step_increment: 1, value: 1}),
        });

        this._positionRow.connect('notify::value', () => {
            if (this._suppressPositionNotify)
                return;
            const order = this._positionOrder();
            const from = order.indexOf(this._appId);
            const to = this._positionRow.value - 1;
            if (from === -1 || from === to)
                return;
            order.splice(to, 0, ...order.splice(from, 1));
            setAppPriorities(this._settings, order);
        });

        this._syncPositionRow();

        return this._positionRow;
    }

    // The config also holds closed and uninstalled apps, so its numbers drift
    // from what the panel shows.
    _positionOrder() {
        return readVisibleOrder() ?? orderedAppIds(this._settings);
    }

    _syncPositionRow() {
        const order = this._positionOrder();
        const index = order.indexOf(this._appId);
        const isAbsent = index === -1;

        this._positionRow.sensitive = !isAbsent && order.length > 1;
        if (this._data.is_hidden) {
            this._positionRow.subtitle = _('Hidden icons have no position.');
        } else if (isAbsent) {
            this._positionRow.subtitle = '';
        } else {
            // Numbered placeholders so a translation can put the count first.
            // GJS ships no String.prototype.format, hence the plain replace.
            this._positionRow.subtitle = _('Position %1 of %2, counted from the left.')
                .replace('%1', String(index + 1))
                .replace('%2', String(order.length));
        }

        this._suppressPositionNotify = true;
        this._positionRow.adjustment.set_upper(Math.max(order.length, 1));
        this._positionRow.adjustment.set_value(isAbsent ? 1 : index + 1);
        this._suppressPositionNotify = false;
    }

    _buildCustomIconRow() {
        const iconResult = this._resolveIcon();

        const iconImage = createImage({pixel_size: ICON_PREVIEW_SIZE_PX});
        applyIconPreview(iconImage, iconResult, this._settings);

        const resetButton = createIconButton('bti-reset-symbolic', {
            tooltip: _('Reset icon'),
            visible: !!this._data.custom_icon,
        });

        resetButton.connect('clicked', () => {
            this._updateValue('custom_icon', null);
            const newResult = this._resolveIcon();
            iconRow.set_subtitle(_('Default app icon'));
            applyIconPreview(iconImage, newResult, this._settings);
            resetButton.visible = false;
        });

        const iconRow = createActionRow({
            title: _('Custom Icon'),
            subtitle: this._data.custom_icon ? this._data.custom_icon : _('Default app icon'),
            prefixWidget: iconImage,
            suffixWidgets: [resetButton],
            suffixIcon: NEXT_ICON_NAME,
            activatable: true,
        });

        iconRow.connect('activated', () => {
            const currentIcon = this._data.custom_icon || this._data.detected_icon || null;

            const picker = new IconPickerDialog(
                this._settings,
                null,
                [],
                selectedIcon => {
                    this._updateValue('custom_icon', selectedIcon);
                    const newResult = this._resolveIcon();
                    iconRow.set_subtitle(selectedIcon);
                    applyIconPreview(iconImage, newResult, this._settings);
                    resetButton.visible = true;
                },
                currentIcon
            );

            picker.present(this);
        });
        return iconRow;
    }

    _buildStatusBadgeRow() {
        const openDialog = () => new StatusBadgeDialog(this._settings, this._appId, this._data)
            .present(this.get_root());
        return createActionRow({
            title: _('Status Icons and Badges'),
            subtitle: _('Unread badge and per-state icons.'),
            suffixIcon: NEXT_ICON_NAME,
            onActivate: openDialog,
            badge: {text: _('Experimental')},
        });
    }

    _refreshFromBlob() {
        const fresh = getAppConfigMap(this._settings)[this._appId];
        if (!fresh)
            return;
        this._data = fresh;
        this._syncPositionRow();
        if (this._statusBadgeRow)
            this._statusBadgeRow.visible = !!this._data.custom_icon;
    }

    _updateValue(key, value) {
        if (value === null)
            delete this._data[key];
        else
            this._data[key] = value;

        setAppConfigValue(this._settings, this._appId, key, value);
    }

    _resolveIcon() {
        return resolveIcon(this._data, hasThemeIcon, this._cachedExists(), this._themeHit());
    }

    _cachedExists() {
        return this._iconPaths.get(this._data.cached_icon_path);
    }

    _themeHit() {
        const key = themeProbeKey(this._data);
        return key ? this._iconPaths.get(key) : null;
    }

    vfunc_dispose() {
        // A close inside the debounce window must not drop the typed name.
        if (this._debounceId)
            this._updateValue('custom_title', this._nameRow.text);
        clearIds(this, removeTimer, '_debounceId');
        super.vfunc_dispose();
    }
}
