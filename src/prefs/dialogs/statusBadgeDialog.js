import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {setAppConfigValue, mutateAppConfig, getAppConfigMap, findStateIconEntry, sameStateKey, ATTENTION_STATE_KEY, RESERVED_OBJECT_KEYS} from '../../shared/appConfig.js';
import {resolveIcon} from '../../shared/iconLoading.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {createButton, createColorSwatch, createIconButton, createImage, applyIconPreview, attachBadge} from '../widgets/gtkHelpers.js';
import {createActionRow, createExpanderSection, NEXT_ICON_NAME} from '../widgets/rows.js';
import IconPickerDialog from './iconPicker.js';
import {buildDialogShell, dialogSizeProps, pinDialogWidth, buildGroupDialog} from './dialogs.js';
import {BADGE_POSITIONS, BADGE_DEFAULT_COLOR, BADGE_DEFAULT_TEXT_COLOR} from '../../const.js';

const STATUS_BADGE_DIALOG_WIDTH_PX = 480;

const ACCENT_DIALOG_WIDTH_PX = 360;

const BADGE_MAX_SIZE_PX = 48;
// The shell clamps a dot's radius to half its size, more would be unreachable.
const BADGE_MAX_RADIUS_PX = BADGE_MAX_SIZE_PX / 2;

export default class StatusBadgeDialog extends Adw.Dialog {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsStatusBadgeDialog'}, this);
    }

    _init(settings, appId, appData) {
        super._init({
            ...dialogSizeProps(),
            title: _('Status Icons and Badges'),
        });

        this._settings = settings;
        this._appId = appId;
        this._data = appData;
        this._suppressUnreadNotify = false;

        this._buildUI();

        connectScoped(this, this._settings, 'changed::app-configs',
            () => this._refreshFromBlob(), 'closed');
    }

    _buildUI() {
        // Own overlay: a toast on the window would sit under this dialog.
        const {toolbarView, page, toast} = buildDialogShell({toast: true});
        this.set_child(toolbarView);
        this._toastOverlay = toast;
        pinDialogWidth(this, STATUS_BADGE_DIALOG_WIDTH_PX);

        const switchGroup = new Adw.PreferencesGroup();
        page.add(switchGroup);

        // A proxy has no state or icon signal a dot could follow, only the
        // LauncherEntry count, so its subtitle must not promise more.
        const isProxy = this._data.is_background_proxy === true;
        const unreadRow = new Adw.SwitchRow({
            title: _('Badges'),
            subtitle: isProxy
                ? _('Shows the unread count when the app sends one.')
                : _('Shows a badge on state changes, with the count when the app sends one.'),
            active: this._data.unread_badge === true,
        });
        attachBadge(unreadRow, _('Experimental'));
        unreadRow.connect('notify::active', () => {
            if (this._suppressUnreadNotify)
                return;
            this._data.unread_badge = unreadRow.active || undefined;
            setAppConfigValue(this._settings, this._appId, 'unread_badge', unreadRow.active || null);
            this._syncSections(unreadRow.active);
        });
        this._unreadRow = unreadRow;
        switchGroup.add(unreadRow);

        // Badge on shows the look, badge off shows the per-state list, so the
        // dialog only ever exposes one of the two at a time.
        this._styleGroup = new Adw.PreferencesGroup();
        page.add(this._styleGroup);
        this._styleGroup.add(this._buildRestingRow());
        this._styleGroup.add(this._buildPositionRow());
        this._styleGroup.add(this._buildRadiusRow());
        this._styleGroup.add(this._buildSizeRow());
        this._styleGroup.add(this._buildColorRow(_('Background Color'), 'color', 'color_accent', BADGE_DEFAULT_COLOR));
        this._styleGroup.add(this._buildColorRow(_('Text Color'), 'text_color', 'text_color_accent', BADGE_DEFAULT_TEXT_COLOR));

        this._stateGroup = null;
        if (isProxy) {
            const noticeGroup = new Adw.PreferencesGroup();
            noticeGroup.add(new Adw.Banner({
                title: _('Status icons cannot work here: the app has no tray icon and never reports a status, its icon comes from its desktop entry.'),
                revealed: true,
            }));
            page.add(noticeGroup);
        } else {
            this._stateGroup = new Adw.PreferencesGroup();
            page.add(this._stateGroup);
            this._stateGroup.add(this._buildStateIconsExpander());
        }

        this._syncSections(this._data.unread_badge === true);
    }

    _syncSections(badgeOn) {
        this._styleGroup.visible = badgeOn;
        if (this._stateGroup)
            this._stateGroup.visible = !badgeOn;
    }

    _badgeStyle() {
        return this._data.badge_style ?? {};
    }

    // Unset fields fall back to the shell defaults, and an emptied object
    // leaves the blob entirely.
    _setBadgeStyleField(field, value) {
        mutateAppConfig(this._settings, this._appId, entry => {
            const style = entry.badge_style ?? (entry.badge_style = {});
            if (value === null || value === undefined)
                delete style[field];
            else
                style[field] = value;
            if (Object.keys(style).length === 0)
                delete entry.badge_style;
            this._data.badge_style = entry.badge_style;
        });
    }

    // The name alert and the content dot keep separate baselines, so both have
    // to go for the next frame to become the reference.
    _buildRestingRow() {
        const button = createButton({
            label: _('Define'),
            callback: () => {
                mutateAppConfig(this._settings, this._appId, entry => {
                    delete entry.detected_icon;
                    delete entry.detected_icon_hash;
                });
                this._toast(_('Resting state updated.'));
            },
        });
        return createActionRow(_('Resting State'),
            _('Takes what the app shows right now as its calm look.'),
            {suffixWidgets: [button]});
    }

    _buildPositionRow() {
        const labels = [_('Bottom Right'), _('Bottom Left'), _('Top Right'), _('Top Left')];
        const dropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(labels),
            valign: Gtk.Align.CENTER,
            selected: Math.max(0, BADGE_POSITIONS.indexOf(this._badgeStyle().position ?? BADGE_POSITIONS[0])),
        });
        dropdown.connect('notify::selected', () => {
            const value = BADGE_POSITIONS[dropdown.selected];
            this._setBadgeStyleField('position', value === BADGE_POSITIONS[0] ? null : value);
        });
        return createActionRow(_('Position'), null, {suffixWidgets: [dropdown]});
    }

    _buildRadiusRow() {
        const row = new Adw.SpinRow({
            title: _('Corner Radius (px)'),
            subtitle: _('0 is square, high is round.'),
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: BADGE_MAX_RADIUS_PX, step_increment: 1,
                // Unset renders as a full circle, so preselect the roundest value.
                value: this._badgeStyle().radius ?? BADGE_MAX_RADIUS_PX,
            }),
        });
        row.connect('notify::value', () => {
            this._setBadgeStyleField('radius', row.value < BADGE_MAX_RADIUS_PX ? row.value : null);
        });
        return row;
    }

    _buildSizeRow() {
        const row = new Adw.SpinRow({
            title: _('Size'),
            subtitle: _('0 uses the automatic size.'),
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: BADGE_MAX_SIZE_PX, step_increment: 1,
                value: this._badgeStyle().size ?? 0,
            }),
        });
        row.connect('notify::value', () => {
            this._setBadgeStyleField('size', row.value > 0 ? row.value : null);
        });
        return row;
    }

    // Mirrors the popup Background color row, hand-wired because badge_style is a
    // per-app blob field, not a GSettings key the createColorRow factory can bind.
    _buildColorRow(title, colorField, accentField, fallback) {
        const usingAccent = () => this._badgeStyle()[accentField] === true;
        const {button, sync} = createColorSwatch(title, {
            read: () => this._badgeStyle()[colorField] || fallback,
            write: value => this._setBadgeStyleField(colorField, value),
            usingAccent,
        });
        const syncAll = () => {
            sync();
            button.sensitive = !usingAccent();
        };
        syncAll();

        const bucket = createIconButton('bti-color-symbolic', {
            tooltip_text: _('More colors'),
            callback: () => this._openAccentDialog(title, accentField, syncAll),
        });
        // The paint-bucket goes in first so it lands left of the swatch.
        return createActionRow(title, null, {suffixWidgets: [bucket, button]});
    }

    _openAccentDialog(title, accentField, onChange) {
        const {group, present} = buildGroupDialog({
            title,
            width: ACCENT_DIALOG_WIDTH_PX,
            groupTitle: title,
        });
        const row = new Adw.SwitchRow({
            title: _('Use Accent Color'),
            active: this._badgeStyle()[accentField] === true,
        });
        row.connect('notify::active', () => {
            this._setBadgeStyleField(accentField, row.active || null);
            onChange();
        });
        group.add(row);
        present(this);
    }

    _buildStateIconsExpander() {
        const addBtn = createIconButton('bti-add-symbolic', {
            tooltip_text: _('Add a state'),
            callback: () => this._showAddStateEntry(),
        });

        this._stateSection = createExpanderSection({
            title: _('Status Icons'),
            subtitle: _('Override the icon for app states like attention or sync.'),
            headerSuffix: addBtn,
            experimental: true,
        });
        this._addStateEntryRow = null;
        this._rebuildStateRows();

        return this._stateSection.expander;
    }

    _showAddStateEntry() {
        this._stateSection.expander.expanded = true;
        if (this._addStateEntryRow) {
            this._addStateEntryRow.grab_focus();
            return;
        }

        const entryRow = new Adw.EntryRow({
            title: _('State name, e.g. state-error'),
            show_apply_button: true,
        });
        entryRow.connect('apply', () => this._addState(entryRow.text));

        this._addStateEntryRow = entryRow;
        this._rebuildStateRows();
        entryRow.grab_focus();
    }

    _rebuildStateRows() {
        const rows = [this._buildStateRow(ATTENTION_STATE_KEY)];
        if (this._addStateEntryRow)
            rows.push(this._addStateEntryRow);
        for (const name of this._listStateNames())
            rows.push(this._buildStateRow(name));

        this._stateSection.setRows(rows);
    }

    _listStateNames() {
        let names = [...this._seenIcons()];

        // A single seen name matching the baseline is just the default
        // app icon, which the custom icon row already covers.
        if (names.length === 1 && sameStateKey(names[0], this._data.detected_icon))
            names = [];

        for (const key of Object.keys(this._data.state_icons ?? {})) {
            if (key === ATTENTION_STATE_KEY)
                continue;
            if (!names.some(n => sameStateKey(n, key)))
                names.push(key);
        }
        // The setter refuses reserved keys, but imported blobs can still
        // carry them, so keep them out of the UI.
        return names.filter(name => !RESERVED_OBJECT_KEYS.has(name));
    }

    _buildStateRow(stateKey) {
        const isAttention = stateKey === ATTENTION_STATE_KEY;
        const mapped = findStateIconEntry(this._data.state_icons, stateKey)?.[1] ?? null;
        const observed = isAttention ||
            this._seenIcons().some(s => sameStateKey(s, stateKey));

        const preview = createImage({pixel_size: 24});
        const previewValue = mapped ?? (isAttention ? null : stateKey);
        applyIconPreview(preview, previewValue ? resolveIcon({custom_icon: previewValue}) : null, this._settings);

        const suffixWidgets = [];
        if (mapped) {
            // Observed states keep their row through seen_icons. Manual
            // entries would lose theirs, so a reset only nulls their icon.
            suffixWidgets.push(createIconButton('bti-reset-symbolic', {
                tooltip_text: _('Reset icon'),
                callback: () => observed
                    ? this._removeStateIcon(stateKey)
                    : this._setStateIcon(stateKey, null),
            }));
        }
        if (!observed) {
            suffixWidgets.push(createIconButton('bti-trash-symbolic', {
                extraClasses: ['destructive-action'],
                tooltip_text: _('Remove'),
                callback: () => this._removeStateIcon(stateKey),
            }));
        }

        const fallbackSubtitle = isAttention
            ? _('Applies only when the app itself reports attention.')
            : _('Automatic');
        const row = createActionRow(isAttention ? _('Attention') : stateKey, mapped ?? fallbackSubtitle, {
            prefixWidget: preview,
            suffixWidgets,
            suffixIcon: NEXT_ICON_NAME,
            onActivate: () => this._openStatePicker(stateKey),
            // A configured state is known even if its name fell out of the
            // seen window, so don't badge it as unseen
            badge: !observed && !mapped ? {text: _('Not seen yet')} : null,
        });

        return row;
    }

    _openStatePicker(stateKey) {
        const current = findStateIconEntry(this._data.state_icons, stateKey)?.[1] ?? null;
        const fallback = stateKey === ATTENTION_STATE_KEY ? null : stateKey;

        const picker = new IconPickerDialog(
            this._settings,
            null,
            [],
            selectedIcon => this._setStateIcon(stateKey, selectedIcon),
            current ?? fallback
        );
        picker.present(this);
    }

    _setStateIcon(stateKey, iconValue) {
        let freshStates;
        mutateAppConfig(this._settings, this._appId, entry => {
            const states = entry.state_icons ?? (entry.state_icons = {});
            const existingKey = findStateIconEntry(states, stateKey)?.[0];
            if (existingKey && existingKey !== stateKey)
                delete states[existingKey];
            states[stateKey] = iconValue;
            freshStates = states;
        });
        this._data.state_icons = freshStates;
        this._rebuildStateRows();
    }

    _removeStateIcon(stateKey) {
        let freshStates = null;
        mutateAppConfig(this._settings, this._appId, entry => {
            const states = entry.state_icons ?? {};
            const existingKey = findStateIconEntry(states, stateKey)?.[0] ?? stateKey;
            delete states[existingKey];
            if (Object.keys(states).length > 0) {
                entry.state_icons = states;
                freshStates = states;
            } else {
                delete entry.state_icons;
            }
        });
        if (freshStates)
            this._data.state_icons = freshStates;
        else
            delete this._data.state_icons;
        this._rebuildStateRows();
    }

    _refreshFromBlob() {
        const fresh = getAppConfigMap(this._settings)[this._appId];
        if (!fresh)
            return;

        const before = this._stateRowSignature();
        this._data = fresh;
        if (this._stateSection && this._stateRowSignature() !== before)
            this._rebuildStateRows();

        // A sync pull can flip the badge under the open dialog, and the
        // switch decides which section the next toggle writes from.
        const badgeOn = this._data.unread_badge === true;
        if (this._unreadRow.active !== badgeOn) {
            this._suppressUnreadNotify = true;
            this._unreadRow.active = badgeOn;
            this._suppressUnreadNotify = false;
            this._syncSections(badgeOn);
        }
    }

    _stateRowSignature() {
        return JSON.stringify([this._listStateNames(), this._data.detected_icon,
            this._data.state_icons ?? null, this._seenIcons()]);
    }

    _seenIcons() {
        return Array.isArray(this._data.seen_icons) ? this._data.seen_icons : [];
    }

    _addState(rawName) {
        const name = rawName.trim();
        if (!name) {
            this._addStateEntryRow = null;
            this._rebuildStateRows();
            return;
        }

        if (sameStateKey(name, ATTENTION_STATE_KEY) || RESERVED_OBJECT_KEYS.has(name)) {
            this._toast(_('This name is not allowed.'));
            return;
        }

        if (findStateIconEntry(this._data.state_icons, name)) {
            this._toast(_('This state already exists.'));
            return;
        }

        this._addStateEntryRow = null;
        this._setStateIcon(name, null);
        this._openStatePicker(name);
    }

    _toast(title) {
        this._toastOverlay.add_toast(new Adw.Toast({title}));
    }
}
