import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';
import {pathOrThemedIcon} from '../../shared/icon.js';
import {createColorButton, createIconButton, attachBadge} from './gtkHelpers.js';
import {openStyleDialog, openUri} from '../dialogs/dialogs.js';

export {attachBadge};

export function buildPrefsWidget(page, settings, keysToReset) {
    const toolbarView = new Adw.ToolbarView();
    page.set_child(toolbarView);

    const headerBar = new Adw.HeaderBar();
    toolbarView.add_top_bar(headerBar);

    if (keysToReset && keysToReset.length > 0) {
        const resetBtn = createIconButton('edit-undo-symbolic', {
            circular: false,
            tooltip_text: _('Reset'),
            callback: () => keysToReset.forEach(key => settings.reset(key)),
        });
        headerBar.pack_end(resetBtn);
    }

    const contentPage = new Adw.PreferencesPage();
    toolbarView.set_content(contentPage);

    // Stash the toolbar so callers can pin a banner above the content.
    contentPage._toolbarView = toolbarView;

    return contentPage;
}

// `displayOptions` are the translated user-facing labels, `valueMap` the
// GSettings strings, indexed in parallel.
export function createComboRow(title, subtitle, settings, key, displayOptions, valueMap, options = {}) {
    const row = new Adw.ComboRow({
        title,
        subtitle: subtitle || '',
        model: new Gtk.StringList({strings: displayOptions}),
    });

    const currentValue = settings.get_string(key);
    const index = valueMap.indexOf(currentValue);
    if (index !== -1)
        row.selected = index;

    row.connect('notify::selected', () => {
        const selectedIndex = row.selected;
        if (selectedIndex >= 0 && selectedIndex < valueMap.length)
            settings.set_string(key, valueMap[selectedIndex]);
    });

    // Keep UI in sync with external setting changes like the Reset button.
    const updateRow = () => {
        const val = settings.get_string(key);
        const idx = valueMap.indexOf(val);
        if (idx !== -1 && row.selected !== idx)
            row.selected = idx;
    };
    connectScoped(row, settings, `changed::${key}`, updateRow);

    _applyExperimental(row, options, settings, key);

    return row;
}

export function createSpinRow(title, settings, key, min = 0, max = 100, step = 1) {
    const row = new Adw.SpinRow({
        title,
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// `options.variants` adds a paint-bucket button beside the color picker
// that opens a small dialog with related color rows like hover or active.
// Shape: { parent, title, description, items: [{ type:'color', title, key }] }.
export function createColorRow(title, settings, key, options = {}) {
    const row = new Adw.ActionRow({title});
    const colorButton = createColorButton(settings, key, title);

    // Suffix order matters. Rows pack add_suffix() left-to-right, so the
    // variants paint-bucket goes first to land left of the color swatch.
    if (options.variants && Array.isArray(options.variants.items) && options.variants.items.length > 0) {
        const variants = options.variants;
        const variantBtn = createIconButton('applications-graphics-symbolic', {
            tooltip_text: _('More colors'),
            callback: () => openStyleDialog(options.parent, settings, {
                title: variants.title || title,
                description: variants.description,
                items: variants.items,
            }),
        });
        row.add_suffix(variantBtn);
    }

    row.add_suffix(colorButton);

    return row;
}

export function createSwitchRow(title, subtitle, settings, key, options = {}) {
    const row = new Adw.SwitchRow({
        title,
        subtitle: subtitle || '',
    });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    _applyExperimental(row, options, settings, key);
    return row;
}

export function createEntryRow(title, settings, key) {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function createSubpageRow(title, subtitle, iconName, window, SubpageClass, settings, dependencyKey = null, invertDependency = false) {
    const row = new Adw.ActionRow({
        title,
        subtitle: subtitle || '',
        activatable: true,
    });

    if (iconName)
        row.add_prefix(new Gtk.Image({icon_name: iconName, pixel_size: 24, valign: Gtk.Align.CENTER}));
    row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic', valign: Gtk.Align.CENTER}));

    row.connect('activated', () => {
        const subpage = new SubpageClass(window, settings);
        window.push_subpage(subpage);
    });

    if (dependencyKey) {
        const flags = invertDependency ? Gio.SettingsBindFlags.INVERT_BOOLEAN : Gio.SettingsBindFlags.DEFAULT;
        settings.bind(dependencyKey, row, 'sensitive', flags);
    }
    return row;
}

export function createIconPickerRow(title, settings, key, window, PickerClass, iconList, options = {}) {
    const row = new Adw.ActionRow({
        title,
        subtitle: settings.get_string(key),
        activatable: true,
    });

    const iconPreview = new Gtk.Image({pixel_size: 24, valign: Gtk.Align.CENTER});

    // ThemedIcon fallback keeps GTK4 from showing a blank image when the
    // icon name isn't in the current theme.
    const applyIconToImage = (img, val) => {
        if (!val) {
            img.clear();
            return;
        }
        img.set_from_gicon(pathOrThemedIcon(val));
    };

    applyIconToImage(iconPreview, settings.get_string(key));

    row.add_suffix(iconPreview);
    row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic', valign: Gtk.Align.CENTER}));

    const updateRow = () => {
        const newVal = settings.get_string(key);
        row.set_subtitle(newVal);
        applyIconToImage(iconPreview, newVal);
    };

    connectScoped(row, settings, `changed::${key}`, updateRow);

    row.connect('activated', () => {
        const picker = new PickerClass(settings, key, iconList, null, null, options);
        picker.present(window);
    });

    return row;
}

export function createComplexActionRow(title, subtitle, settings, mainKey, displayOptions, values, window, AdvancedConfigClass, advancedConfigData) {
    const row = new Adw.ActionRow({
        title,
        subtitle: subtitle || '',
        activatable: false,
    });

    const gearBtn = createIconButton('emblem-system-symbolic', {
        flat: false,
        tooltip_text: _('Configure advanced actions'),
        callback: () => {
            const widget = new AdvancedConfigClass(window, settings, advancedConfigData);
            widget.present(window);
        },
    });

    const dropdown = new Gtk.DropDown({
        model: new Gtk.StringList({strings: displayOptions}),
        valign: Gtk.Align.CENTER,
        width_request: 240,
    });

    const currentVal = settings.get_string(mainKey);
    const idx = values.indexOf(currentVal);
    if (idx !== -1)
        dropdown.selected = idx;

    dropdown.connect('notify::selected', () => {
        const newIdx = dropdown.selected;
        if (newIdx >= 0 && newIdx < values.length)
            settings.set_string(mainKey, values[newIdx]);
    });

    const updateDropdown = () => {
        const val = settings.get_string(mainKey);
        const newIdx = values.indexOf(val);
        if (newIdx !== -1 && dropdown.selected !== newIdx)
            dropdown.selected = newIdx;
    };
    connectScoped(row, settings, `changed::${mainKey}`, updateDropdown);

    row.add_suffix(gearBtn);
    row.add_suffix(dropdown);

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

export function createActionRow(title, subtitle, options = {}) {
    const {prefixIcon, suffixIcon, headerSuffix, activatable, onActivate, experimental} = options;

    const row = new Adw.ActionRow({
        title,
        subtitle: subtitle || '',
        activatable: activatable || !!onActivate,
    });

    if (onActivate)
        row.connect('activated', onActivate);


    if (prefixIcon)
        row.add_prefix(new Gtk.Image({icon_name: prefixIcon, pixel_size: 24, valign: Gtk.Align.CENTER}));


    if (experimental)
        attachBadge(row, _('Experimental'));

    if (headerSuffix) {
        if (headerSuffix instanceof Gtk.Widget)
            headerSuffix.valign = Gtk.Align.CENTER;
        row.add_suffix(headerSuffix);
    }

    if (suffixIcon)
        row.add_suffix(new Gtk.Image({icon_name: suffixIcon, valign: Gtk.Align.CENTER}));


    return row;
}

export function createLinkRow(title, subtitle, iconName, window, url) {
    return createActionRow(title, subtitle, {prefixIcon: iconName, onActivate: () => openUri(window, url)});
}

// `keyPrefix` is joined with each side: e.g. 'toggle-padding' →
// 'toggle-padding-top', '-bottom', '-left', '-right'.
export function createBoxSidesGroup(title, settings, keyPrefix, {min = 0, max = 50, step = 1} = {}) {
    const sides = [
        ['top', _('Top')],
        ['bottom', _('Bottom')],
        ['left', _('Left')],
        ['right', _('Right')],
    ];
    const group = new Adw.PreferencesGroup({title});
    sides.forEach(([side, label]) => {
        group.add(createSpinRow(label, settings, `${keyPrefix}-${side}`, min, max, step));
    });
    return group;
}

// Builds the Icon + Background color row pair used by tray icons and toggle
// button. Each row has a paint-bucket variant button for the hover color.
// `keyPrefix` examples: 'icon-' or 'toggle-icon-'.
export function createIconColorPair(parent, settings, keyPrefix) {
    const specs = [
        {title: _('Icon'),       key: `${keyPrefix}color`,            hoverKey: `${keyPrefix}hover-color`,            variantTitle: _('Icon Color')},
        {title: _('Background'), key: `${keyPrefix}background-color`, hoverKey: `${keyPrefix}hover-background-color`, variantTitle: _('Background Color')},
    ];
    return specs.map(s => createColorRow(s.title, settings, s.key, {
        parent,
        variants: {
            title: s.variantTitle,
            items: [{type: 'color', title: _('Hover'), key: s.hoverKey}],
        },
    }));
}

// `experimental: true` pins the badge on; `experimentalValues` shows it only
// when the current setting matches one of those values.
function _applyExperimental(row, options, settings, key) {
    if (options.experimental) {
        attachBadge(row, _('Experimental'));
        return;
    }
    const values = options.experimentalValues;
    if (!Array.isArray(values) || values.length === 0)
        return;
    const badge = attachBadge(row, _('Experimental'));
    const update = () => {
        badge.visible = values.includes(settings.get_string(key));
    };
    connectScoped(row, settings, `changed::${key}`, update);
    update();
}
