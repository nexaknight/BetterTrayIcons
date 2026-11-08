import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Gsk from 'gi://Gsk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {accentValueKeeping, colorBehindAccent} from '../../shared/accentColor.js';
import {COLOR_VARIANT_KEY} from '../../shared/colorVariant.js';
import {connectScoped, watchKeys} from '../../shared/lifecycle.js';
import {attachBadge, createBadgeBox} from './badge.js';
import {createBoundToggleButton, createDialogGearButton, createHelpButton, createIconButton} from './button.js';
import {createColorButton, editedColorKey, editedColorUsesAccent, watchColorKey} from './color.js';
import {buildGroupDialog} from './dialog.js';
import {applyPathIcon, NEXT_ICON_NAME, RESET_ICON_NAME} from './icon.js';
import IconEmojiPicker from './iconEmojiPicker.js';
import {setIconSubtitle} from './emoji.js';
import {pushSubpage} from './sidebar.js';
import {getChildren} from './text.js';

// Keeps the dropdowns on the actions page flush.
export const ACTION_DROPDOWN_WIDTH_PX = 240;

// Both put the tray in the top panel, so they share the panel's rows
export const PANEL_DISPLAY_MODES = Object.freeze(['popup', 'drawer']);

const ROW_ICON_SIZE_PX = 24;

const RANGE_SCALE_WIDTH_PX = 160;

// Room for two digits even when the range starts at a single one, the
// position row grows its upper bound after it is built.
const SPIN_MIN_WIDTH_CHARS = 2;
const SPIN_TEXT_XALIGN_END = 1;

const STYLE_DIALOG_WIDTH_PX = 420;

const WRAP_CONTROLS_MAX_FRACTION = 0.6;
const WRAP_ROW_H_GAP_PX = 12;
const WRAP_ROW_V_GAP_PX = 8;
const WRAP_ROW_SIDE_PX = 12;
const WRAP_ROW_HELP_GAP_PX = 12;
const WRAP_ROW_V_MARGIN_PX = 10;
const WRAP_CONTROLS_SPACING_PX = 12;

// Adwaita's pencil has no property, only this style class
const ENTRY_EDIT_ICON_CLASS = 'edit-icon';

export function addConfigRows(group, settings, specs) {
    for (const spec of specs)
        group.add(_createConfigRow(settings, spec));
}

function _createConfigRow(settings, spec) {
    const row = CONFIG_ROW_BUILDERS[spec.type](settings, spec);

    if (spec.hiddenWhenAccent) {
        const key = spec.hiddenWhenAccent;
        watchColorKey(row, settings, key, () => (row.visible = !editedColorUsesAccent(settings, key)));
    }

    const visibleKeys = [spec.visibleByKey ?? []].flat();
    if (visibleKeys.length) {
        bindGroupsVisible(row, settings, [row],
            () => visibleKeys.every(key => settings.get_boolean(key)), ...visibleKeys);
    }

    return row;
}

const CONFIG_ROW_BUILDERS = Object.freeze({
    combo: (settings, spec) => createComboRow({...spec, settings}),
    segmented: (settings, spec) => createSegmentedRow({...spec, settings}),
    switch: (settings, spec) => createSwitchRow({...spec, settings}),
    accent: (settings, spec) => _createAccentSwitchRow(spec.title, settings, spec.key),
    spin: (settings, spec) => createSpinRow({...spec, settings}),
    color: (settings, spec) => _createColorRow(spec.title, settings, spec.key),
});

export function createComboRow({title, subtitle = '', settings, key, options, values, width = -1, help = null}) {
    const dropdown = _createBoundDropdown(settings, key, options, values, {width, label: title});
    return _createWrapRow(title, subtitle, [dropdown], help);
}

function _createWrapRow(title, subtitle, controls, help, options) {
    return new Adw.PreferencesRow({child: _createWrapBox(title, subtitle, controls, help, options), activatable: false});
}

// Like createActionRow, with the badge line as a third line under the text.
// The line keeps its height while empty, see createBadgeLine, so the rows of
// a list stay the same height with and without badges.
export function createBadgedActionRow({title, subtitle = '', prefixWidget = null, badgeLine, suffixWidgets = [], suffixIcon = null, onActivate}) {
    const content = new Gtk.Box({
        spacing: WRAP_ROW_H_GAP_PX,
        margin_top: WRAP_ROW_V_MARGIN_PX,
        margin_bottom: WRAP_ROW_V_MARGIN_PX,
        margin_start: WRAP_ROW_SIDE_PX,
        margin_end: WRAP_ROW_SIDE_PX,
    });
    if (prefixWidget)
        content.append(_centered(prefixWidget));
    const titles = _createTitles(title, subtitle, null);
    titles.hexpand = true;
    badgeLine.margin_top = WRAP_ROW_V_GAP_PX;
    titles.append(badgeLine);
    content.append(titles);
    suffixWidgets.forEach(widget => content.append(_centered(widget)));
    if (suffixIcon)
        content.append(new Gtk.Image({icon_name: suffixIcon, valign: Gtk.Align.CENTER}));

    const row = new Adw.PreferencesRow({child: content, activatable: true});
    // A plain preferences row has no activated signal, its list reports it.
    const mapId = row.connect('map', () => {
        row.disconnect(mapId);
        connectScoped(row, row.get_parent(), 'row-activated', (_list, activated) => {
            if (activated === row)
                onActivate();
        });
    });
    return row;
}

// A stretching box hands the slider the full width once the controls drop
// below the title, a start-aligned one keeps them under the text.
function _createWrapBox(title, subtitle, controls, help, {stretch = false, keepTextWhole = false} = {}) {
    const titles = _createTitles(title, subtitle, help);
    const controlsBox = new Gtk.Box({
        spacing: WRAP_CONTROLS_SPACING_PX,
        halign: stretch ? Gtk.Align.FILL : Gtk.Align.END,
        valign: Gtk.Align.CENTER,
    });
    controls.forEach(widget => controlsBox.append(widget));

    const box = new Gtk.Box({
        layout_manager: new WrapRowLayout(keepTextWhole),
        margin_top: WRAP_ROW_V_MARGIN_PX,
        margin_bottom: WRAP_ROW_V_MARGIN_PX,
        margin_start: WRAP_ROW_SIDE_PX,
        margin_end: WRAP_ROW_SIDE_PX,
    });
    box.append(titles);
    box.append(controlsBox);
    return box;
}

function _createTitles(title, subtitle, help) {
    const titles = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        valign: Gtk.Align.CENTER,
    });
    const titleLabel = new Gtk.Label({label: title, halign: Gtk.Align.START, wrap: true, xalign: 0});
    // The help shares the title line, so it stays up there when the controls
    // drop under the text. A ready button is one the caller shows and hides.
    if (help) {
        const titleLine = new Gtk.Box({spacing: WRAP_ROW_HELP_GAP_PX});
        titleLabel.hexpand = true;
        titleLine.append(titleLabel);
        titleLine.append(help instanceof Gtk.Widget ? help : createHelpButton(help, {compact: true}));
        titles.append(titleLine);
    } else {
        titles.append(titleLabel);
    }
    if (subtitle) {
        titles.append(new Gtk.Label({
            label: subtitle,
            halign: Gtk.Align.START,
            wrap: true,
            xalign: 0,
            css_classes: ['caption', 'dimmed'],
        }));
    }
    return titles;
}

// A wrap box wraps as soon as the unwrapped title stops fitting, so a long
// subtitle pushes the controls down in a row with room to spare for them.
const WrapRowLayout = GObject.registerClass({GTypeName: 'BetterTrayIconsWrapRowLayout'},
    class WrapRowLayout extends Gtk.LayoutManager {
        // With keepTextWhole the controls also drop as soon as the title or
        // subtitle would have to wrap beside them, an app row's ID reads badly
        // broken over lines.
        _init(keepTextWhole = false) {
            super._init();
            this._keepTextWhole = keepTextWhole;
        }

        vfunc_get_request_mode(_widget) {
            return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
        }

        vfunc_measure(widget, orientation, forSize) {
            const [titles, controlsBox] = getChildren(widget);
            if (orientation === Gtk.Orientation.HORIZONTAL) {
                const [titlesMin, titlesNatural] = titles.measure(orientation, -1);
                const [controlsMin, controlsNatural] = controlsBox.measure(orientation, -1);
                return [Math.max(titlesMin, controlsMin),
                    titlesNatural + WRAP_ROW_H_GAP_PX + controlsNatural, -1, -1];
            }

            const [, controlsWidth] = controlsBox.measure(Gtk.Orientation.HORIZONTAL, -1);
            if (forSize >= 0 && this._dropsBelow(titles, controlsWidth, forSize)) {
                const [titlesMin, titlesNatural] = titles.measure(orientation, forSize);
                const [controlsMin, controlsNatural] = controlsBox.measure(orientation, forSize);
                return [titlesMin + WRAP_ROW_V_GAP_PX + controlsMin,
                    titlesNatural + WRAP_ROW_V_GAP_PX + controlsNatural, -1, -1];
            }
            const titlesWidth = forSize >= 0
                ? Math.max(1, forSize - controlsWidth - WRAP_ROW_H_GAP_PX)
                : -1;
            const [titlesMin, titlesNatural] = titles.measure(orientation, titlesWidth);
            const [controlsMin, controlsNatural] = controlsBox.measure(orientation, -1);
            return [Math.max(titlesMin, controlsMin),
                Math.max(titlesNatural, controlsNatural), -1, -1];
        }

        vfunc_allocate(widget, width, height, _baseline) {
            const [titles, controlsBox] = getChildren(widget);
            const [, controlsWidth] = controlsBox.measure(Gtk.Orientation.HORIZONTAL, -1);

            if (this._dropsBelow(titles, controlsWidth, width)) {
                const [, titlesHeight] = titles.measure(Gtk.Orientation.VERTICAL, width);
                titles.allocate(width, titlesHeight, -1, null);
                const controlsY = titlesHeight + WRAP_ROW_V_GAP_PX;
                controlsBox.allocate(width, Math.max(0, height - controlsY), -1,
                    Gsk.Transform.new().translate(new Graphene.Point({x: 0, y: controlsY})));
                return;
            }

            const titlesWidth = Math.max(1, width - controlsWidth - WRAP_ROW_H_GAP_PX);
            titles.allocate(titlesWidth, height, -1, null);
            controlsBox.allocate(controlsWidth, height, -1,
                Gsk.Transform.new().translate(new Graphene.Point({x: width - controlsWidth, y: 0})));
        }

        _dropsBelow(titles, controlsWidth, width) {
            const [titlesMin, titlesNatural] = titles.measure(Gtk.Orientation.HORIZONTAL, -1);
            const areControlsTooWide = controlsWidth > width * WRAP_CONTROLS_MAX_FRACTION;
            const willCrushTitles = width - controlsWidth - WRAP_ROW_H_GAP_PX < titlesMin;
            const willWrapText = this._keepTextWhole && controlsWidth > 0 &&
                width - controlsWidth - WRAP_ROW_H_GAP_PX < titlesNatural;
            return areControlsTooWide || willCrushTitles || willWrapText;
        }
    });

// A caller that names no bounds takes the schema's, so the two cannot drift.
export function createSpinRow({title, subtitle = '', settings, key, min, max, step = 1, help = null}) {
    const {min: lower = 0, max: upper} = min === undefined ? _schemaRange(settings, key) : {min, max};
    const adjustment = new Gtk.Adjustment({lower, upper, step_increment: step});
    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    return createAdjustmentSpinRow({title, subtitle, adjustment, help});
}

function _schemaRange(settings, key) {
    const [, [min, max]] = settings.settings_schema.get_key(key).get_range().recursiveUnpack();
    return {min, max};
}

// Adw.SpinRow draws loose text between two round buttons, the plain spin
// button keeps Adwaita's single rounded pill.
export function createAdjustmentSpinRow({title, subtitle = '', adjustment, help = null}) {
    return createActionRow({title, subtitle, suffixWidgets: [_createSpinButton(title, adjustment)], help});
}

// A fixed field keeps the pill still while the digit count changes, the
// number hugs the right edge and a new digit grows to the left.
function _createSpinButton(title, adjustment) {
    const widthChars = Math.max(SPIN_MIN_WIDTH_CHARS, String(adjustment.upper).length);
    const spinButton = new Gtk.SpinButton({
        adjustment,
        numeric: true,
        valign: Gtk.Align.CENTER,
        width_chars: widthChars,
        xalign: SPIN_TEXT_XALIGN_END,
    });
    spinButton.update_property([Gtk.AccessibleProperty.LABEL], [title]);
    return spinButton;
}

// One adjustment drives the slider and the number, so each follows the other at
// once and a typed value clamps to the range.
export function createRangeRow({title, subtitle = '', settings, key, min = 0, max, step = 1}) {
    const adjustment = new Gtk.Adjustment({lower: min, upper: max, step_increment: step});
    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    const scale = new Gtk.Scale({
        adjustment,
        draw_value: false,
        round_digits: 0,
        width_request: RANGE_SCALE_WIDTH_PX,
        hexpand: true,
        valign: Gtk.Align.CENTER,
    });
    scale.update_property([Gtk.AccessibleProperty.LABEL], [title]);

    return _createWrapRow(title, subtitle, [scale, _createSpinButton(title, adjustment)], null, {stretch: true});
}

export function createSegmentedRow({title, subtitle = '', settings, key, options, values, negate = null, help = null}) {
    const group = createBoundToggleGroup({title, settings, key, options, values});
    const negateButton = negate ? _createNegateButton(settings, negate, group, options) : null;

    return createActionRow({title, subtitle, suffixWidgets: [negateButton, group].filter(Boolean), help});
}

export function createToggleGroup({title, options, values, active, onChange}) {
    const group = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
    options.forEach((label, i) => group.add(new Adw.Toggle({label, name: values[i]})));
    group.update_property([Gtk.AccessibleProperty.LABEL], [title]);
    group.active_name = active;
    group.connect('notify::active-name', () => onChange(group.active_name));
    return group;
}

export function createBoundToggleGroup({title, settings, key, options, values}) {
    const group = createToggleGroup({
        title,
        options,
        values,
        active: settings.get_string(key),
        onChange: value => {
            if (value && value !== settings.get_string(key))
                settings.set_string(key, value);
        },
    });
    watchKeys(group, settings, [key], () => (group.active_name = settings.get_string(key)));
    return group;
}

// A toggle group beside a badge outgrows a narrow row, so the controls drop
// under the text the way the select rows do.
export function createWrapControlsRow({title, subtitle = '', controls, badge = null, help = null, keepTextWhole = false}) {
    const badgeBox = badge ? createBadgeBox(badge) : null;
    return _createWrapRow(title, subtitle, [badgeBox, ...controls].filter(Boolean), help, {keepTextWhole});
}

function _createNegateButton(settings, {key, iconName, tooltip}, group, options) {
    const button = createBoundToggleButton(settings, key, {iconName, tooltip});

    const sync = () => {
        const isNegated = settings.get_boolean(key);
        options.forEach((label, i) => {
            group.get_toggle(i).label = isNegated ? `-${label}` : label;
        });
    };
    watchKeys(group, settings, [key], sync);

    return button;
}

function _createColorRow(title, settings, key, {accentAware = false, parent = null, variants = null, help = null} = {}) {
    const row = new Adw.ActionRow({title});
    const colorButton = createColorButton(settings, key, title);

    if (accentAware)
        watchColorKey(colorButton, settings, key, () => (colorButton.sensitive = !editedColorUsesAccent(settings, key)));

    // Adw rows pack add_suffix() left-to-right, so the paint-bucket goes in
    // first to land left of the color swatch.
    if (variants) {
        row.add_suffix(createIconButton('bti-color-symbolic', {
            tooltip: _('More colors'),
            onClick: () => _openStyleDialog(parent, settings, {
                title: variants.title,
                items: variants.items,
            }),
        }));
    }

    row.add_suffix(colorButton);
    _addHelp(row, help);

    return row;
}

// dialog.js importing this module back would close an import cycle.
function _openStyleDialog(parentWindow, settings, {title, items}) {
    const {group, present} = buildGroupDialog({
        title,
        width: STYLE_DIALOG_WIDTH_PX,
        groupTitle: title,
    });

    addConfigRows(group, settings, items);
    present(parentWindow);
}

export function createSwitchRow({title, subtitle = '', settings, key, help = null}) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    _addHelp(row, help);
    return row;
}

// For a value stored outside GSettings, the caller writes it on each toggle
export function createValueSwitchRow({title, subtitle = '', active, onToggle}) {
    const row = new Adw.SwitchRow({title, subtitle, active});
    row.connect('notify::active', () => onToggle(row.active));
    return row;
}

export function createSubpageRow({title, subtitle = '', window, SubpageClass, settings, prefixIcon = null, help = null}) {
    return createActionRow({
        title,
        subtitle,
        help,
        prefixWidget: prefixIcon ? new Gtk.Image({icon_name: prefixIcon}) : null,
        suffixIcon: NEXT_ICON_NAME,
        onActivate: () => pushSubpage(window, new SubpageClass(window, settings)),
    });
}

export function createIconEmojiPickerRow({title, settings, key, icons, ...options}) {
    const iconPreview = new Gtk.Image({pixel_size: ROW_ICON_SIZE_PX, valign: Gtk.Align.CENTER});
    const row = createActionRow({
        title,
        suffixWidgets: [iconPreview],
        suffixIcon: NEXT_ICON_NAME,
        onActivate: () => new IconEmojiPicker({settings, key, icons, ...options}).popupFor(row),
    });

    watchKeys(row, settings, [key], () => {
        const value = settings.get_string(key);
        setIconSubtitle(row, value);
        applyPathIcon(iconPreview, value, settings);
    });
    return row;
}

export function createComplexActionRow({title, subtitle = '', settings, key, options, values, window, DialogClass, dialogData, help = null}) {
    const gearButton = createDialogGearButton({
        window,
        settings,
        DialogClass,
        dialogData,
        tooltip: _('Configure advanced actions'),
    });

    const dropdown = _createBoundDropdown(settings, key, options, values,
        {width: ACTION_DROPDOWN_WIDTH_PX, label: title});

    return _createWrapRow(title, subtitle, [gearButton, dropdown], help);
}

// Adw.SwitchRow packs its switch as the first suffix, so a gear added afterwards
// lands right of it. Built by hand to keep the gear on the left.
export function createComplexSwitchRow({title, subtitle = '', settings, key, window, DialogClass, dialogData, gearFollowsSwitch = true, help = null}) {
    const gearButton = createDialogGearButton({window, settings, DialogClass, dialogData});
    if (gearFollowsSwitch)
        settings.bind(key, gearButton, 'sensitive', Gio.SettingsBindFlags.GET);

    const toggle = new Gtk.Switch();
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    toggle.update_property([Gtk.AccessibleProperty.LABEL], [title]);

    const row = createActionRow({title, subtitle, suffixWidgets: [gearButton, toggle], activatable: true, help});
    row.activatable_widget = toggle;

    return row;
}

export function bindVisibility(settings, key, widget, targetValue) {
    const targets = [targetValue].flat();
    bindGroupsVisible(widget, settings, [widget], () => targets.includes(settings.get_string(key)), key);
}

export function createActionRow({
    title,
    subtitle = '',
    prefixIcon = null,
    prefixWidget = null,
    suffixIcon = null,
    suffixWidgets = [],
    headerSuffix = null,
    badge = null,
    badgeVisibility = null,
    activatable = false,
    onActivate = null,
    help = null,
}) {
    const row = new Adw.ActionRow({
        title,
        subtitle,
        activatable: activatable || !!onActivate,
    });

    if (onActivate)
        row.connect('activated', onActivate);

    if (prefixIcon)
        row.add_prefix(new Gtk.Image({icon_name: prefixIcon, pixel_size: ROW_ICON_SIZE_PX, valign: Gtk.Align.CENTER}));

    if (prefixWidget)
        row.add_prefix(_centered(prefixWidget));

    const badgeBox = attachBadge(row, badge);
    if (badgeBox && badgeVisibility)
        badgeVisibility.settings.bind(badgeVisibility.key, badgeBox, 'visible', Gio.SettingsBindFlags.GET);

    if (headerSuffix)
        row.add_suffix(_centered(headerSuffix));

    for (const widget of suffixWidgets)
        row.add_suffix(_centered(widget));

    if (suffixIcon)
        row.add_suffix(new Gtk.Image({icon_name: suffixIcon, valign: Gtk.Align.CENTER}));

    _addHelp(row, help);

    return row;
}

// A reset takes the place of Adwaita's pencil, so the row hints at one
// thing at a time. At resetText it goes insensitive instead of away, so the
// row never loses its hint.
export function createEntryRow({title, text = '', showApplyButton = false, resetText = '', onReset = null}) {
    const row = new Adw.EntryRow({title, text, show_apply_button: showApplyButton});
    if (!onReset)
        return row;

    _findDescendant(row, ENTRY_EDIT_ICON_CLASS).visible = false;
    const resetButton = createIconButton(RESET_ICON_NAME, {tooltip: _('Reset'), onClick: onReset});
    const syncResetButton = () => {
        resetButton.sensitive = row.text !== resetText;
    };
    syncResetButton();
    row.connect('notify::text', syncResetButton);
    row.add_suffix(resetButton);
    return row;
}

function _findDescendant(widget, cssClass) {
    for (const child of getChildren(widget)) {
        const match = child.has_css_class(cssClass) ? child : _findDescendant(child, cssClass);
        if (match)
            return match;
    }
    return null;
}

// Leads the suffixes where a gear would sit, so the switches of a group stay
// in one column whether a row has help or not.
function _addHelp(row, help) {
    if (!help)
        return;
    const button = createHelpButton(help);
    row.add_suffix(button);
    button.get_parent().reorder_child_after(button, null);
}

export function createExpanderSection({title, subtitle = '', headerSuffix = null, badge = null}) {
    const expander = new Adw.ExpanderRow({title, subtitle});

    if (headerSuffix)
        expander.add_suffix(_centered(headerSuffix));

    // Adw.ExpanderRow prepends its suffixes while Adw.ActionRow appends them,
    // so the badge has to go in last to land left of the header button.
    attachBadge(expander, badge);

    let rows = [];
    const setRows = next => {
        for (const row of rows)
            expander.remove(row);
        rows = [...next];
        for (const row of rows)
            expander.add_row(row);
    };

    return {expander, setRows};
}

export function bindGroupsVisible(owner, settings, groups, isVisible, ...keys) {
    watchKeys(owner, settings, keys, () => groups.forEach(group => (group.visible = isVisible())));
}

export function createColorSetRow({settings, splitKey}) {
    const tabs = createBoundToggleGroup({
        title: _('Color Set'),
        settings,
        key: COLOR_VARIANT_KEY,
        options: [_('Dark'), _('Light')],
        values: ['dark', 'light'],
    });

    const split = new Gtk.Switch({valign: Gtk.Align.CENTER});
    split.update_property([Gtk.AccessibleProperty.LABEL], [_('Separate colors for the light and dark style.')]);
    settings.bind(splitKey, split, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind(splitKey, tabs, 'visible', Gio.SettingsBindFlags.GET);

    const row = createActionRow({
        title: _('Color Set'),
        subtitle: _('Separate colors for the light and dark style.'),
        suffixWidgets: [tabs, split],
    });
    row.activatable_widget = split;
    return row;
}

export function createIconColorRows({parent, settings, keyPrefix}) {
    return [
        {title: _('Icon'),       key: `${keyPrefix}color`,            hoverKey: `${keyPrefix}hover-color`,            variantTitle: _('Icon Color')},
        {title: _('Background'), key: `${keyPrefix}background-color`, hoverKey: `${keyPrefix}hover-background-color`, variantTitle: _('Background Color')},
        {title: _('Border'),     key: `${keyPrefix}border-color`,     hoverKey: `${keyPrefix}hover-border-color`,     variantTitle: _('Border Color')},
    ].map(spec => createAccentColorRow({parent, settings, ...spec}));
}

export function createAccentColorRow({parent, settings, title, key, hoverKey = null, variantTitle, help = null}) {
    const items = [{type: 'accent', title: _('Use Accent Color'), key}];
    if (hoverKey) {
        items.push(
            {type: 'accent', title: _('Use Accent Color on Hover'), key: hoverKey},
            {type: 'color', title: _('Hover'), key: hoverKey, hiddenWhenAccent: hoverKey});
    }
    return _createColorRow(title, settings, key, {
        parent,
        accentAware: true,
        variants: {title: variantTitle, items},
        help,
    });
}

function _createAccentSwitchRow(title, settings, colorKey) {
    const row = new Adw.SwitchRow({title});
    let isSyncing = false;
    const sync = () => {
        isSyncing = true;
        row.active = editedColorUsesAccent(settings, colorKey);
        isSyncing = false;
    };

    row.connect('notify::active', () => {
        if (isSyncing)
            return;
        const edited = editedColorKey(settings, colorKey);
        const current = settings.get_string(edited);
        if (row.active) {
            settings.set_string(edited, accentValueKeeping(current));
            return;
        }
        // Nothing to come back to when the accent was set by hand or by a
        // migration that had no color to keep.
        const previous = colorBehindAccent(current);
        if (previous)
            settings.set_string(edited, previous);
        else
            settings.reset(edited);
    });

    watchColorKey(row, settings, colorKey, sync);
    return row;
}

// A bare Gtk.DropDown announces no row title to screen readers, so unlike
// Adw.ComboRow it needs the label wired in by hand.
function _createBoundDropdown(settings, key, displayOptions, values, {width = -1, label}) {
    const dropdown = new Gtk.DropDown({
        model: new Gtk.StringList({strings: displayOptions}),
        valign: Gtk.Align.CENTER,
        width_request: width,
    });

    // The stylesheet has no flat variant for the dropdown node itself, only the
    // internal toggle button picks up button.flat styling.
    dropdown.get_first_child().add_css_class('flat');

    dropdown.update_property([Gtk.AccessibleProperty.LABEL], [label]);

    // No valid selection reads as undefined and skips the write instead of
    // clearing the setting.
    dropdown.connect('notify::selected', () => {
        const value = values[dropdown.selected];
        if (value !== undefined && value !== settings.get_string(key))
            settings.set_string(key, value);
    });
    watchKeys(dropdown, settings, [key], () => {
        const index = values.indexOf(settings.get_string(key));
        if (index !== -1)
            dropdown.selected = index;
    });

    return dropdown;
}

// Adw rows stretch prefix and suffix children to the full row height.
function _centered(widget) {
    widget.valign = Gtk.Align.CENTER;
    return widget;
}

