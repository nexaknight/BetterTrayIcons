import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Gsk from 'gi://Gsk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {accentValueKeeping, colorBehindAccent} from '../../shared/accentColor.js';
import {COLOR_VARIANT_KEY} from '../../shared/colorVariant.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {attachBadge} from './badge.js';
import {createBoundToggleButton, createDialogGearButton, createIconButton} from './button.js';
import {createColorButton, editedColorKey, editedColorUsesAccent, watchColorKey} from './color.js';
import {buildGroupDialog} from './dialog.js';
import {applyPathIcon, NEXT_ICON_NAME} from './icon.js';
import {pushSubpage} from './sidebar.js';

// Keeps the gear column on the actions page flush.
const ACTION_DROPDOWN_WIDTH_PX = 240;

const ROW_ICON_SIZE_PX = 24;

const STYLE_DIALOG_WIDTH_PX = 420;

const WRAP_CONTROLS_MAX_FRACTION = 0.6;
const WRAP_ROW_H_GAP_PX = 12;
const WRAP_ROW_V_GAP_PX = 8;

export function addConfigRows(group, settings, specs) {
    for (const spec of specs)
        group.add(_createConfigRow(settings, spec));
}

function _createConfigRow(settings, spec) {
    const row = CONFIG_ROW_BUILDERS[spec.type](settings, spec);

    if (spec.hiddenWhenAccent) {
        const key = spec.hiddenWhenAccent;
        const sync = () => (row.visible = !editedColorUsesAccent(settings, key));
        sync();
        watchColorKey(row, settings, key, sync);
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
    // A spec that names no bounds takes the schema's, so the two cannot drift.
    spin: (settings, spec) => {
        const bounds = spec.min === undefined ? _schemaRange(settings, spec.key) : {};
        return createSpinRow({...bounds, ...spec, settings});
    },
    color: (settings, spec) => _createColorRow(spec.title, settings, spec.key),
});

export function createComboRow({title, subtitle = '', settings, key, options, values}) {
    const dropdown = _createBoundDropdown(settings, key, options, values, {label: title});
    return _createWrapRow(title, subtitle, [dropdown]);
}

function _createWrapRow(title, subtitle, controls) {
    const titles = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        valign: Gtk.Align.CENTER,
    });
    titles.append(new Gtk.Label({label: title, halign: Gtk.Align.START, wrap: true, xalign: 0}));
    if (subtitle) {
        titles.append(new Gtk.Label({
            label: subtitle,
            halign: Gtk.Align.START,
            wrap: true,
            xalign: 0,
            css_classes: ['caption', 'dim-label'],
        }));
    }

    const controlsBox = new Gtk.Box({spacing: 12, halign: Gtk.Align.END, valign: Gtk.Align.CENTER});
    controls.forEach(widget => controlsBox.append(widget));

    const box = new Gtk.Box({
        layout_manager: new WrapRowLayout(),
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 12,
        margin_end: 12,
    });
    box.append(titles);
    box.append(controlsBox);

    return new Adw.PreferencesRow({child: box, activatable: false});
}

function _getChildren(widget) {
    const children = [];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        children.push(child);
    return children;
}

// A wrap box wraps as soon as the unwrapped title stops fitting, so a long
// subtitle pushes the controls down in a row with room to spare for them.
const WrapRowLayout = GObject.registerClass({GTypeName: 'BetterTrayIconsWrapRowLayout'},
    class WrapRowLayout extends Gtk.LayoutManager {
        vfunc_get_request_mode(_widget) {
            return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
        }

        vfunc_measure(widget, orientation, forSize) {
            const [titles, controlsBox] = _getChildren(widget);
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
            const [titles, controlsBox] = _getChildren(widget);
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
            const [titlesMin] = titles.measure(Gtk.Orientation.HORIZONTAL, -1);
            const controlsTooWide = controlsWidth > width * WRAP_CONTROLS_MAX_FRACTION;
            const titlesWouldCrush = width - controlsWidth - WRAP_ROW_H_GAP_PX < titlesMin;
            return controlsTooWide || titlesWouldCrush;
        }
    });

export function createSpinRow({title, subtitle = '', settings, key, min = 0, max, step = 1}) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function _schemaRange(settings, key) {
    const [, [min, max]] = settings.settings_schema.get_key(key).get_range().recursiveUnpack();
    return {min, max};
}

export function createSegmentedRow({title, subtitle = '', settings, key, options, values, negate = null}) {
    const group = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
    options.forEach((label, i) => group.add(new Adw.Toggle({label, name: values[i]})));
    group.update_property([Gtk.AccessibleProperty.LABEL], [title]);

    _bindSelectionToSetting(group, settings, key, {
        signal: 'notify::active-name',
        getValue: w => w.active_name || null,
        setValue: (w, value) => (w.active_name = value),
    });

    const negateButton = negate ? _createNegateButton(settings, negate, group, options) : null;

    return createActionRow({title, subtitle, suffixWidgets: [negateButton, group].filter(Boolean)});
}

function _createNegateButton(settings, {key, iconName, tooltip}, group, options) {
    const button = createBoundToggleButton(settings, key, {iconName, tooltip});

    const sync = () => {
        const negated = settings.get_boolean(key);
        options.forEach((label, i) => {
            group.get_toggle(i).label = negated ? `-${label}` : label;
        });
    };
    connectScoped(group, settings, `changed::${key}`, sync);
    sync();

    return button;
}

function _createColorRow(title, settings, key, {accentAware = false, parent = null, variants = null} = {}) {
    const row = new Adw.ActionRow({title});
    const colorButton = createColorButton(settings, key, title);

    if (accentAware) {
        const sync = () => (colorButton.sensitive = !editedColorUsesAccent(settings, key));
        sync();
        watchColorKey(colorButton, settings, key, sync);
    }

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

    return row;
}

// Lives here rather than in dialog.js because it needs addConfigRows, and
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

export function createSwitchRow({title, subtitle = '', settings, key}) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function createSubpageRow({title, subtitle = '', window, SubpageClass, settings, prefixIcon = null}) {
    return createActionRow({
        title,
        subtitle,
        prefixWidget: prefixIcon ? new Gtk.Image({icon_name: prefixIcon}) : null,
        suffixIcon: NEXT_ICON_NAME,
        onActivate: () => pushSubpage(window, new SubpageClass(window, settings)),
    });
}

export function createIconPickerRow({title, settings, key, window, PickerClass, icons, ...options}) {
    const iconPreview = new Gtk.Image({pixel_size: ROW_ICON_SIZE_PX, valign: Gtk.Align.CENTER});
    applyPathIcon(iconPreview, settings.get_string(key), settings);

    const row = createActionRow({
        title,
        subtitle: settings.get_string(key),
        suffixWidgets: [iconPreview],
        suffixIcon: NEXT_ICON_NAME,
        onActivate: () => {
            const picker = new PickerClass(settings, key, icons, null, null, options);
            picker.present(window);
        },
    });

    const updateRow = () => {
        const newValue = settings.get_string(key);
        row.set_subtitle(newValue);
        applyPathIcon(iconPreview, newValue, settings);
    };

    connectScoped(row, settings, `changed::${key}`, updateRow);

    return row;
}

export function createComplexActionRow({title, subtitle = '', settings, key, options, values, window, DialogClass, dialogData}) {
    const gearButton = createDialogGearButton({
        window,
        settings,
        DialogClass,
        dialogData,
        tooltip: _('Configure advanced actions'),
    });

    const dropdown = _createBoundDropdown(settings, key, options, values,
        {width: ACTION_DROPDOWN_WIDTH_PX, label: title});

    return _createWrapRow(title, subtitle, [gearButton, dropdown]);
}

// Adw.SwitchRow packs its switch as the first suffix, so a gear added afterwards
// lands right of it. Built by hand to keep the gear on the left.
export function createComplexSwitchRow({title, subtitle = '', settings, key, window, DialogClass, dialogData, gearFollowsSwitch = true}) {
    const gearButton = createDialogGearButton({window, settings, DialogClass, dialogData});
    if (gearFollowsSwitch)
        settings.bind(key, gearButton, 'sensitive', Gio.SettingsBindFlags.GET);

    const toggle = new Gtk.Switch();
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    toggle.update_property([Gtk.AccessibleProperty.LABEL], [title]);

    const row = createActionRow({title, subtitle, suffixWidgets: [gearButton, toggle], activatable: true});
    row.activatable_widget = toggle;

    return row;
}

export function bindVisibility(settings, key, widget, targetValue) {
    const updateState = () => {
        const current = settings.get_string(key);
        widget.visible = current === targetValue;
    };

    updateState();
    connectScoped(widget, settings, `changed::${key}`, updateState);
}

export function createActionRow({title, subtitle = '', prefixIcon = null, prefixWidget = null, suffixIcon = null, suffixWidgets = [], headerSuffix = null, badge = null, activatable = false, onActivate = null}) {
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

    attachBadge(row, badge);

    if (headerSuffix)
        row.add_suffix(_centered(headerSuffix));

    for (const widget of suffixWidgets)
        row.add_suffix(_centered(widget));

    if (suffixIcon)
        row.add_suffix(new Gtk.Image({icon_name: suffixIcon, valign: Gtk.Align.CENTER}));

    return row;
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
    const sync = () => groups.forEach(group => (group.visible = isVisible()));
    keys.forEach(key => connectScoped(owner, settings, `changed::${key}`, sync));
    sync();
}

export function createColorSetRow({settings, splitKey}) {
    const tabs = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
    [[_('Dark'), 'dark'], [_('Light'), 'light']].forEach(([label, name]) => tabs.add(new Adw.Toggle({label, name})));
    tabs.update_property([Gtk.AccessibleProperty.LABEL], [_('Color Set')]);
    _bindSelectionToSetting(tabs, settings, COLOR_VARIANT_KEY, {
        signal: 'notify::active-name',
        getValue: w => w.active_name || null,
        setValue: (w, value) => (w.active_name = value),
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

export function createAccentColorRow({parent, settings, title, key, hoverKey = null, variantTitle}) {
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

    sync();
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

    _bindSelectionToSetting(dropdown, settings, key, {
        signal: 'notify::selected',
        getValue: w => w.selected < values.length ? values[w.selected] : null,
        setValue: (w, value) => {
            const index = values.indexOf(value);
            if (index !== -1)
                w.selected = index;
        },
    });

    return dropdown;
}

// getValue returning null means "no valid selection", which skips the
// write instead of clearing the setting.
function _bindSelectionToSetting(widget, settings, key, {signal, getValue, setValue}) {
    setValue(widget, settings.get_string(key));

    widget.connect(signal, () => {
        const value = getValue(widget);
        if (value !== null && value !== settings.get_string(key))
            settings.set_string(key, value);
    });

    connectScoped(widget, settings, `changed::${key}`, () => {
        const value = settings.get_string(key);
        if (getValue(widget) !== value)
            setValue(widget, value);
    });
}

// Adw rows stretch prefix and suffix children to the full row height.
function _centered(widget) {
    widget.valign = Gtk.Align.CENTER;
    return widget;
}

