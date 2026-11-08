import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {setAppConfigValue, mutateAppConfig, getAppConfigMap, findStateIconEntry, sameStateKey, ATTENTION_STATE_KEY, RESERVED_OBJECT_KEYS} from '../../shared/appConfig.js';
import {resolveIcon} from '../../shared/iconLoading.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {attachBadge} from '../components/badge.js';
import {createButton, createIconButton} from '../components/button.js';
import {createImage} from '../components/image.js';
import {createAlert, buildDialogShell, pinDialogWidth, buildGroupDialog} from '../components/dialog.js';
import {createColorSwatch} from '../components/color.js';
import {applyIconPreview, NEXT_ICON_NAME, RESET_ICON_NAME} from '../components/icon.js';
import {createActionRow, createAdjustmentSpinRow, createEntryRow, createExpanderSection, createValueSwitchRow} from '../components/row.js';
import IconEmojiPicker from '../components/iconEmojiPicker.js';
import {setIconSubtitle} from '../components/emoji.js';
import {BADGE_POSITIONS, BADGE_DEFAULT_COLOR, BADGE_DEFAULT_TEXT_COLOR} from '../../const.js';

const STATUS_BADGE_DIALOG_WIDTH_PX = 480;

const ACCENT_DIALOG_WIDTH_PX = 360;

const ICON_PREVIEW_SIZE_PX = 24;

const BADGE_MAX_SIZE_PX = 48;
// The shell clamps a dot's radius to half its size, more would be unreachable.
const BADGE_MAX_RADIUS_PX = BADGE_MAX_SIZE_PX / 2;

export default class StatusBadgeDialog extends Adw.Dialog {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsStatusBadgeDialog'}, this);
    }

    _init(settings, appId, appData) {
        super._init({
            follows_content_size: true,
            title: _('Status Icons and Badges'),
        });

        this._settings = settings;
        this._appId = appId;
        this._data = appData;
        this._isUnreadNotifySuppressed = false;

        this._buildUI();
        pinDialogWidth(this, STATUS_BADGE_DIALOG_WIDTH_PX);

        connectScoped(this, this._settings, 'changed::app-configs',
            () => this._refreshFromBlob(), 'closed');
    }

    _buildUI() {
        // Own overlay, a toast on the window would sit under this dialog.
        const {toolbarView, page, toast} = buildDialogShell({toast: true});
        this.set_child(toolbarView);
        this._toastOverlay = toast;

        const switchGroup = new Adw.PreferencesGroup();
        page.add(switchGroup);

        // A proxy has no state or icon signal a dot could follow, only the
        // LauncherEntry count, so its subtitle must not promise more.
        const isProxy = this._data.is_background_proxy === true;
        const unreadRow = createValueSwitchRow({
            title: _('Badges'),
            subtitle: isProxy
                ? _('Shows the unread count when the app sends one.')
                : _('Shows a badge on state changes, with the count when the app sends one.'),
            active: this._data.unread_badge === true,
            onToggle: isBadgeOn => {
                if (this._isUnreadNotifySuppressed)
                    return;
                this._data.unread_badge = isBadgeOn || undefined;
                setAppConfigValue(this._settings, this._appId, 'unread_badge', isBadgeOn || null);
                this._syncSections(isBadgeOn);
            },
        });
        attachBadge(unreadRow, {text: _('Experimental')});
        this._unreadRow = unreadRow;
        switchGroup.add(unreadRow);

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
            page.add(createAlert(
                _('Status icons cannot work here: the app has no tray icon and never reports a status, its icon comes from its desktop entry.'),
                {variant: 'warning'}));
        } else {
            this._stateGroup = new Adw.PreferencesGroup();
            page.add(this._stateGroup);
            this._stateGroup.add(this._buildStateIconsExpander());
        }

        this._syncSections(this._data.unread_badge === true);
    }

    _syncSections(isBadgeOn) {
        this._styleGroup.visible = isBadgeOn;
        if (this._stateGroup)
            this._stateGroup.visible = !isBadgeOn;
    }

    _badgeStyle() {
        return this._data.badge_style ?? {};
    }

    // Unset fields fall back to the shell defaults, and an emptied object
    // leaves the blob entirely.
    _setBadgeStyleField(field, value) {
        mutateAppConfig(this._settings, this._appId, entry => {
            const style = entry.badge_style ?? (entry.badge_style = {});
            if (value === null)
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
            onClick: () => {
                mutateAppConfig(this._settings, this._appId, entry => {
                    delete entry.detected_icon;
                    delete entry.detected_icon_hash;
                });
                this._toast(_('Resting state updated.'));
            },
        });
        return createActionRow({
            title: _('Resting State'),
            subtitle: _('Takes what the app shows right now as its calm look.'),
            suffixWidgets: [button],
        });
    }

    _buildPositionRow() {
        const labels = [_('Bottom Right'), _('Bottom Left'), _('Top Right'), _('Top Left')];
        const dropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(labels),
            valign: Gtk.Align.CENTER,
            selected: Math.max(0, BADGE_POSITIONS.indexOf(this._badgeStyle().position)),
        });
        dropdown.connect('notify::selected', () => {
            const value = BADGE_POSITIONS[dropdown.selected];
            this._setBadgeStyleField('position', value === BADGE_POSITIONS[0] ? null : value);
        });
        return createActionRow({title: _('Position'), suffixWidgets: [dropdown]});
    }

    _buildRadiusRow() {
        const adjustment = new Gtk.Adjustment({
            lower: 0, upper: BADGE_MAX_RADIUS_PX, step_increment: 1,
            // Unset renders as a full circle, so preselect the roundest value.
            value: this._badgeStyle().radius ?? BADGE_MAX_RADIUS_PX,
        });
        adjustment.connect('value-changed', () => {
            this._setBadgeStyleField('radius', adjustment.value < BADGE_MAX_RADIUS_PX ? adjustment.value : null);
        });
        return createAdjustmentSpinRow({title: _('Corner Radius (px)'), subtitle: _('0 is square, high is round.'), adjustment});
    }

    _buildSizeRow() {
        const adjustment = new Gtk.Adjustment({
            lower: 0, upper: BADGE_MAX_SIZE_PX, step_increment: 1,
            value: this._badgeStyle().size ?? 0,
        });
        adjustment.connect('value-changed', () => {
            this._setBadgeStyleField('size', adjustment.value > 0 ? adjustment.value : null);
        });
        return createAdjustmentSpinRow({title: _('Size'), subtitle: _('0 uses the automatic size.'), adjustment});
    }

    // Hand-wired because badge_style is a per-app blob field, not a GSettings
    // key that createColorSwatch can bind.
    _buildColorRow(title, colorField, accentField, fallback) {
        const usingAccent = () => this._badgeStyle()[accentField] === true;
        const {button, sync} = createColorSwatch({
            title,
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
            tooltip: _('More colors'),
            onClick: () => this._openAccentDialog(title, accentField, syncAll),
        });
        return createActionRow({title, suffixWidgets: [bucket, button]});
    }

    _openAccentDialog(title, accentField, onChange) {
        const {group, present} = buildGroupDialog({
            title,
            width: ACCENT_DIALOG_WIDTH_PX,
            groupTitle: title,
        });
        group.add(createValueSwitchRow({
            title: _('Use Accent Color'),
            active: this._badgeStyle()[accentField] === true,
            onToggle: isAccent => {
                this._setBadgeStyleField(accentField, isAccent || null);
                onChange();
            },
        }));
        present(this);
    }

    _buildStateIconsExpander() {
        const addButton = createIconButton('bti-add-symbolic', {
            tooltip: _('Add a state'),
            onClick: () => this._showAddStateEntry(),
        });

        this._stateSection = createExpanderSection({
            title: _('Status Icons'),
            subtitle: _('Override the icon for app states like attention or sync.'),
            headerSuffix: addButton,
            badge: {text: _('Experimental')},
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

        const entryRow = createEntryRow({title: _('State name, e.g. state-error'), showApplyButton: true});
        entryRow.connect('apply', () => this._addState(entryRow.text));

        this._addStateEntryRow = entryRow;
        this._rebuildStateRows();
        entryRow.grab_focus();
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
        this._openStatePicker(name, this._stateRows.get(name));
    }

    _rebuildStateRows() {
        const rows = [this._buildStateRow(ATTENTION_STATE_KEY)];
        if (this._addStateEntryRow)
            rows.push(this._addStateEntryRow);
        const namedRows = this._listStateNames().map(name => [name, this._buildStateRow(name)]);
        this._stateRows = new Map(namedRows);
        rows.push(...namedRows.map(([, row]) => row));

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
        const mapped = findStateIconEntry(this._data.state_icons, stateKey)?.[1];
        const isObserved = isAttention ||
            this._seenIcons().some(s => sameStateKey(s, stateKey));

        const preview = createImage({pixel_size: ICON_PREVIEW_SIZE_PX});
        const previewValue = mapped ?? (isAttention ? null : stateKey);
        applyIconPreview(preview, previewValue ? resolveIcon({custom_icon: previewValue}) : null, this._settings);

        const suffixWidgets = [];
        if (mapped) {
            // Observed states keep their row through seen_icons. Manual
            // entries would lose theirs, so a reset only nulls their icon.
            suffixWidgets.push(createIconButton(RESET_ICON_NAME, {
                tooltip: _('Reset icon'),
                onClick: () => {
                    if (isObserved)
                        this._removeStateIcon(stateKey);
                    else
                        this._setStateIcon(stateKey, null);
                },
            }));
        }
        if (!isObserved) {
            suffixWidgets.push(createIconButton('bti-trash-symbolic', {
                extraClasses: ['destructive-action'],
                tooltip: _('Remove'),
                onClick: () => this._removeStateIcon(stateKey),
            }));
        }

        const fallbackSubtitle = isAttention
            ? _('Applies only when the app itself reports attention.')
            : _('Automatic');
        const row = createActionRow({
            title: isAttention ? _('Attention') : stateKey,
            prefixWidget: preview,
            suffixWidgets,
            suffixIcon: NEXT_ICON_NAME,
            onActivate: () => this._openStatePicker(stateKey, row),
            // A configured state is known even if its name fell out of the
            // seen window, so don't badge it as unseen.
            badge: !isObserved && !mapped ? {text: _('Not seen yet')} : null,
        });

        setIconSubtitle(row, mapped, fallbackSubtitle);

        return row;
    }

    _openStatePicker(stateKey, anchor) {
        const current = findStateIconEntry(this._data.state_icons, stateKey)?.[1];
        const fallback = stateKey === ATTENTION_STATE_KEY ? null : stateKey;

        new IconEmojiPicker({
            settings: this._settings,
            current: current ?? fallback,
            onSelect: selectedIcon => this._setStateIcon(stateKey, selectedIcon),
        }).popupFor(anchor);
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
        const isBadgeOn = this._data.unread_badge === true;
        if (this._unreadRow.active !== isBadgeOn) {
            this._isUnreadNotifySuppressed = true;
            this._unreadRow.active = isBadgeOn;
            this._isUnreadNotifySuppressed = false;
            this._syncSections(isBadgeOn);
        }
    }

    _stateRowSignature() {
        return JSON.stringify([this._listStateNames(), this._data.detected_icon,
            this._data.state_icons, this._seenIcons()]);
    }

    _seenIcons() {
        return Array.isArray(this._data.seen_icons) ? this._data.seen_icons : [];
    }

    _toast(title) {
        this._toastOverlay.add_toast(new Adw.Toast({title}));
    }
}
