import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {setAppConfigValue, deleteAppConfig, defaultAppName, displayAppName, orderedAppIds, readVisibleOrder, setAppPriorities, getAppConfigMap, whenInFrontOf, WHEN_IN_FRONT_NONE, SCROLL_ACTION_DEFAULT} from '../../shared/appConfig.js';
import {themeProbeKey} from '../../shared/iconLoading.js';
import {clearIds, connectScoped, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {createButton, createIconButton} from '../components/button.js';
import {createImage} from '../components/image.js';
import {createCappedBanner, ENTRY_DEBOUNCE_MS, pinDialogWidth, showConfirmationDialog} from '../components/dialog.js';
import {applyIconPreview, resolveAppIcon, watchShownIcons, NEXT_ICON_NAME} from '../components/icon.js';
import {GONE_ICON_NAME} from '../appPresence.js';
import {createActionRow, createToggleGroup, createWrapControlsRow} from '../components/row.js';
import {buildPrefsWidget} from '../components/page.js';
import IconEmojiPicker from '../components/iconEmojiPicker.js';
import {setIconSubtitle} from '../components/emoji.js';
import StatusBadgeDialog from './statusBadgeDialog.js';

const APP_DIALOG_WIDTH_PX = 540;
const ICON_PREVIEW_SIZE_PX = 24;

export default class AppDialog extends Adw.Dialog {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsAppDialog'}, this);
    }

    _init(settings, appId, appData, iconPaths, {onForget, isGone = false}) {
        super._init({
            title: displayAppName(appData, appId) || _('App Settings'),
            follows_content_size: true,
        });

        this._settings = settings;
        this._appId = appId;
        this._data = appData;
        this._iconPaths = iconPaths;
        this._onForget = onForget;
        this._isGone = isGone;
        this._debounceId = 0;
        this._suppressNameNotify = false;
        this._suppressPositionNotify = false;
        this._shownIcon = null;

        this._buildUI();
        pinDialogWidth(this, APP_DIALOG_WIDTH_PX);
        this.connect('closed', () => this._flushPendingName());
        watchShownIcons(this, shown => this._applyShownIcon(shown[appId] ?? null), 'closed');
    }

    _applyShownIcon(shown) {
        if (JSON.stringify(shown) === JSON.stringify(this._shownIcon))
            return;
        this._shownIcon = shown;
        applyIconPreview(this._iconImage, this._resolveIcon(), this._settings);
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
                `${flavor}: ${_('This app draws its tray icon itself via XEmbed. Custom icon and scroll settings do not apply here.')}`,
                {revealed: true}));
            page.add(noticeGroup);
        }

        const group = new Adw.PreferencesGroup({
            title: _('Configuration'),
            description: `${_('ID')}: ${this._appId}`,
        });
        page.add(group);

        group.add(this._buildNameRow());

        const hideRow = new Adw.SwitchRow({
            title: _('Hide Icon'),
            subtitle: _('Don’t show this icon in the tray.'),
            active: this._data.is_hidden === true,
        });

        hideRow.connect('notify::active', () => {
            this._updateValue('is_hidden', hideRow.active);
        });
        group.add(hideRow);

        if (!this._data.is_foreign)
            group.add(this._buildWhenInFrontRow());
        if (!(this._data.is_xembed || this._data.is_background_proxy || this._data.is_foreign))
            group.add(this._buildScrollRow());

        group.add(this._buildPositionRow());

        // A foreign item is drawn by the extension that handed it in, so an icon
        // of ours would never reach it.
        if (!(this._data.is_wine || this._data.is_proton || this._data.is_foreign)) {
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

        this._buildDangerGroup(page);
    }

    _buildNameRow() {
        const defaultName = defaultAppName(this._data, this._appId);
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
        return nameRow;
    }

    _buildWhenInFrontRow() {
        const forcedValue = this._settings.get_string('when-in-front');
        const isForced = forcedValue !== WHEN_IN_FRONT_NONE;
        const title = _('Minimize Action for Unsupported Apps');

        const toggles = createToggleGroup({
            title,
            options: [_('Default'), _('Minimize'), _('Close')],
            values: [WHEN_IN_FRONT_NONE, 'minimize', 'close'],
            active: isForced ? forcedValue : whenInFrontOf(this._data),
            onChange: name => this._updateValue('when_in_front', name),
        });

        const row = createWrapControlsRow({
            title,
            subtitle: isForced
                ? _('Set for every app on the General page.')
                : _('For apps that do not hide themselves when their icon is clicked while they are in front.'),
            controls: [toggles],
            badge: {text: _('Experimental')},
            keepTextWhole: true,
        });
        row.sensitive = !isForced;
        return row;
    }

    _buildScrollRow() {
        const title = _('Scroll');
        const toggles = createToggleGroup({
            title,
            options: [_('Default'), _('Forward'), _('None')],
            values: [SCROLL_ACTION_DEFAULT, 'forward', 'nothing'],
            active: this._data.scroll_action ?? SCROLL_ACTION_DEFAULT,
            onChange: name => this._updateValue('scroll_action', name),
        });

        return createWrapControlsRow({
            title,
            subtitle: _('Forward sends the mouse wheel to the app. Default follows the Actions page.'),
            controls: [toggles],
            keepTextWhole: true,
        });
    }

    // Goes through setAppPriorities like drag and scroll do. Writing a raw
    // priority instead would take PRIORITY_STEP clicks to move one slot.
    _buildPositionRow() {
        this._positionRow = new Adw.SpinRow({
            title: _('Position'),
            adjustment: new Gtk.Adjustment({lower: 1, upper: 1, step_increment: 1, value: 1}),
        });

        this._positionRow.connect('notify::value', async () => {
            if (this._suppressPositionNotify)
                return;
            const order = await this._positionOrder();
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
    async _positionOrder() {
        return await readVisibleOrder() ?? orderedAppIds(this._settings);
    }

    // Forgetting a foreign item that still stands would take a name and a slot
    // from its owner, and a hidden one is only put away with the owner still
    // there. Once the owner is gone for good nobody else can clear the entry.
    async _syncForeignDanger(group) {
        group.visible = false;
        const order = await this._positionOrder();
        group.visible = !this._data.is_hidden && !order.includes(this._appId);
    }

    async _syncPositionRow() {
        const order = await this._positionOrder();
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
        this._iconImage = iconImage;
        if (this._isGone)
            iconImage.set_from_icon_name(GONE_ICON_NAME);
        else
            applyIconPreview(iconImage, iconResult, this._settings);

        const resetButton = createIconButton('bti-reset-symbolic', {
            tooltip: _('Reset icon'),
            visible: !!this._data.custom_icon,
        });

        resetButton.connect('clicked', () => {
            this._updateValue('custom_icon', null);
            const newResult = this._resolveIcon();
            setIconSubtitle(iconRow, null, _('Default app icon'));
            applyIconPreview(iconImage, newResult, this._settings);
            resetButton.visible = false;
        });

        const iconRow = createActionRow({
            title: _('Custom Icon'),
            prefixWidget: iconImage,
            suffixWidgets: [resetButton],
            suffixIcon: NEXT_ICON_NAME,
            activatable: true,
        });

        setIconSubtitle(iconRow, this._data.custom_icon, _('Default app icon'));

        iconRow.connect('activated', () => {
            const currentIcon = this._data.custom_icon || this._data.detected_icon || null;

            new IconEmojiPicker({
                settings: this._settings,
                current: currentIcon,
                onSelect: selectedIcon => {
                    this._updateValue('custom_icon', selectedIcon);
                    const newResult = this._resolveIcon();
                    setIconSubtitle(iconRow, selectedIcon);
                    applyIconPreview(iconImage, newResult, this._settings);
                    resetButton.visible = true;
                },
            }).popupFor(iconRow);
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

    _buildDangerGroup(page) {
        const dangerGroup = new Adw.PreferencesGroup({title: _('Danger Zone')});
        page.add(dangerGroup);
        if (this._data.is_foreign)
            this._syncForeignDanger(dangerGroup);

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
        return resolveAppIcon(this._data, this._shownIcon, this._cachedExists(), this._themeHit());
    }

    _cachedExists() {
        return this._iconPaths.get(this._data.cached_icon_path);
    }

    _themeHit() {
        const key = themeProbeKey(this._data);
        return key ? this._iconPaths.get(key) : null;
    }

    _flushPendingName() {
        if (!this._debounceId)
            return;
        clearIds(this, removeTimer, '_debounceId');
        this._updateValue('custom_title', this._nameRow.text);
    }
}

