import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Gsk from 'gi://Gsk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {usesAccent, accentValueKeeping, colorBehindAccent} from '../../shared/accentColor.js';
import {connectScoped} from '../../shared/lifecycle.js';
import {resetKeys} from '../../shared/settingsIO.js';
import {createColorButton, createIconButton, createLinkToggle, createBoundToggleButton, attachBadge, createBadge, applyPathIcon, ensurePrefsCss, spacingLinkKey} from './gtkHelpers.js';
import {createSidebarToggle, popSubpage, pushSubpage, addToast} from './sidebar.js';
import {buildGroupDialog, buildDialogShell, showConfirmationDialog} from '../dialogs/dialogs.js';

// Keeps the gear column on the actions page flush.
const ACTION_DROPDOWN_WIDTH_PX = 240;

const BADGE_GAP_PX = 6;

const STYLE_DIALOG_WIDTH_PX = 420;

// The schema itself only floors these radii at 0, this is a UI-only cap.
const MAX_BORDER_RADIUS_PX = 50;
const MAX_BORDER_WIDTH_PX = 20;

export const NEXT_ICON_NAME = 'bti-next-symbolic';
export const GEAR_ICON_NAME = 'bti-gear-symbolic';

// Grid slots around the spacing card's center sketch, column/row per side.
const SPACING_SIDE_SLOTS = Object.freeze({
    top: [1, 0], right: [2, 1], bottom: [1, 2], left: [0, 1],
});

// Adw.PreferencesPage clamps its content to 600sp regardless of window
// width (AdwClamp default maximum-size), which after the page's own
// margin leaves about 576sp for the group below. Two spacing cards at
// their previous size needed 564sp, so they wrapped on a hair-thin
// margin even in a window with plenty of visible room to spare. These
// trims keep 48sp of slack against that 576sp ceiling instead.
const SPACING_GRID_COLUMN_SPACING_PX = 6;
const SPACING_CARD_GAP_PX = 8;

export function buildPrefsWidget(page, settings, keysToReset, {window = null} = {}) {
    const {toolbarView, headerBar, page: contentPage} = buildDialogShell();
    page.set_child(toolbarView);

    if (window) {
        // The stock back button would land left of the sidebar toggle and
        // bring its own chevron, so the subpage packs both by hand.
        headerBar.show_back_button = false;
        headerBar.pack_start(createSidebarToggle(window));
        headerBar.pack_start(createIconButton('bti-previous-symbolic', {
            tooltip_text: _('Back'),
            callback: () => popSubpage(window),
        }));
    }

    if (keysToReset.length > 0)
        headerBar.pack_end(createResetButton(settings, keysToReset, {window}));

    return contentPage;
}

// Also serves as a page's header action, where the reset reaches into the
// subpages and gear dialogs, so the confirmation says so.
export function createResetButton(settings, keys, {window = null, includesSubpages = false} = {}) {
    const resetBtn = createIconButton('bti-reset-symbolic', {
        circular: false,
        tooltip_text: _('Reset'),
        callback: () => showConfirmationDialog(
            resetBtn.get_root(),
            _('Reset these settings?'),
            includesSubpages
                ? _('All values of this page, including its dialogs and subpages, will be restored to their defaults.')
                : _('All values on this page will be restored to their defaults.'),
            () => {
                resetKeys(settings, keys);
                if (window)
                    addToast(window, new Adw.Toast({title: _('Settings reset')}));
            },
            _('Reset'),
            true
        ),
    });
    return resetBtn;
}

export function addConfigRows(group, settings, specs) {
    for (const spec of specs)
        group.add(createConfigRow(settings, spec));
}

// Lives here rather than in dialogs.js because it needs addConfigRows, and
// dialogs.js importing this module back would close an import cycle.
function openStyleDialog(parentWindow, settings, {title, description = '', items}) {
    const {group, present} = buildGroupDialog({
        title,
        width: STYLE_DIALOG_WIDTH_PX,
        groupTitle: title,
        groupDescription: description,
    });

    addConfigRows(group, settings, items);
    present(parentWindow);
}

function createConfigRow(settings, conf) {
    const row = CONFIG_ROW_BUILDERS[conf.type](settings, conf);

    if (conf.hiddenWhenAccent) {
        const key = conf.hiddenWhenAccent;
        const sync = () => (row.visible = !usesAccent(settings.get_string(key)));
        sync();
        connectScoped(row, settings, `changed::${key}`, sync);
    }

    const visibleKeys = [conf.visibleByKey ?? []].flat();
    if (visibleKeys.length) {
        bindGroupsVisible(row, settings, [row],
            () => visibleKeys.every(key => settings.get_boolean(key)), ...visibleKeys);
    }

    return row;
}

const CONFIG_ROW_BUILDERS = Object.freeze({
    combo: (settings, conf) => createComboRow(conf.title, conf.subtitle, settings, conf.key, conf.options, conf.values),
    segmented: (settings, conf) => createSegmentedRow(conf.title, conf.subtitle, settings, conf.key, conf.options, conf.values,
        {negate: conf.negate}),
    switch: (settings, conf) => createSwitchRow(conf.title, conf.subtitle, settings, conf.key),
    accent: (settings, conf) => createAccentSwitchRow(conf.title, settings, conf.key),
    // A spec that names no bounds takes the schema's, so the two cannot drift.
    spin: (settings, conf) => {
        const {min, max} = conf.min === undefined ? schemaRange(settings, conf.key) : conf;
        return createSpinRow(conf.title, settings, conf.key, min, max, conf.step, {subtitle: conf.subtitle});
    },
    color: (settings, conf) => createColorRow(conf.title, settings, conf.key),
});

export function createComboRow(title, subtitle, settings, key, displayOptions, valueMap) {
    const dropdown = _createBoundDropdown(settings, key, displayOptions, valueMap, {label: title});
    return _createWrapRow(title, subtitle, [dropdown]);
}

// Title and controls share one line while there is room, on a narrow row
// the controls drop to their own line instead of crushing the title to a
// letter per line. Costs the row-click target the stock rows have, the
// controls stay the only interactive part.
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

const WRAP_CONTROLS_MAX_FRACTION = 0.6;
const WRAP_ROW_H_GAP_PX = 12;
const WRAP_ROW_V_GAP_PX = 8;

function _layoutChildren(widget) {
    const out = [];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        out.push(child);
    return out;
}

// The controls drop below only once they would eat most of the row width,
// until then the title and subtitle wrap their text like the stock rows.
// A wrap box cannot express that: it wraps as soon as the UNWRAPPED title
// stops fitting, so a long subtitle pushed the controls down even in a
// row with plenty of room for them.
const WrapRowLayout = GObject.registerClass({GTypeName: 'BetterTrayIconsWrapRowLayout'},
    class WrapRowLayout extends Gtk.LayoutManager {
        vfunc_get_request_mode(_widget) {
            return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
        }

        vfunc_measure(widget, orientation, forSize) {
            const [titles, controlsBox] = _layoutChildren(widget);
            if (orientation === Gtk.Orientation.HORIZONTAL) {
                const [titlesMin, titlesNat] = titles.measure(orientation, -1);
                const [controlsMin, controlsNat] = controlsBox.measure(orientation, -1);
                return [Math.max(titlesMin, controlsMin),
                    titlesNat + WRAP_ROW_H_GAP_PX + controlsNat, -1, -1];
            }

            const [, controlsNat] = controlsBox.measure(Gtk.Orientation.HORIZONTAL, -1);
            if (forSize >= 0 && this._dropsBelow(titles, controlsNat, forSize)) {
                const [titlesMin, titlesNat] = titles.measure(orientation, forSize);
                const [controlsMin, controlsNatH] = controlsBox.measure(orientation, forSize);
                return [titlesMin + WRAP_ROW_V_GAP_PX + controlsMin,
                    titlesNat + WRAP_ROW_V_GAP_PX + controlsNatH, -1, -1];
            }
            const titlesWidth = forSize >= 0
                ? Math.max(1, forSize - controlsNat - WRAP_ROW_H_GAP_PX)
                : -1;
            const [titlesMin, titlesNat] = titles.measure(orientation, titlesWidth);
            const [controlsMin, controlsNatH] = controlsBox.measure(orientation, -1);
            return [Math.max(titlesMin, controlsMin),
                Math.max(titlesNat, controlsNatH), -1, -1];
        }

        vfunc_allocate(widget, width, height, _baseline) {
            const [titles, controlsBox] = _layoutChildren(widget);
            const [, controlsNat] = controlsBox.measure(Gtk.Orientation.HORIZONTAL, -1);

            if (this._dropsBelow(titles, controlsNat, width)) {
                const [, titlesHeight] = titles.measure(Gtk.Orientation.VERTICAL, width);
                titles.allocate(width, titlesHeight, -1, null);
                const controlsY = titlesHeight + WRAP_ROW_V_GAP_PX;
                controlsBox.allocate(width, Math.max(0, height - controlsY), -1,
                    Gsk.Transform.new().translate(new Graphene.Point({x: 0, y: controlsY})));
                return;
            }

            const titlesWidth = Math.max(1, width - controlsNat - WRAP_ROW_H_GAP_PX);
            titles.allocate(titlesWidth, height, -1, null);
            controlsBox.allocate(controlsNat, height, -1,
                Gsk.Transform.new().translate(new Graphene.Point({x: width - controlsNat, y: 0})));
        }

        _dropsBelow(titles, controlsNat, width) {
            const [titlesMin] = titles.measure(Gtk.Orientation.HORIZONTAL, -1);
            return controlsNat > width * WRAP_CONTROLS_MAX_FRACTION ||
                width - controlsNat - WRAP_ROW_H_GAP_PX < titlesMin;
        }
    });

export function createSpinRow(title, settings, key, min = 0, max = 100, step = 1, {subtitle = ''} = {}) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// For keys the schema already bounds, so a spin row cannot drift from it.
// A key without a <range> unpacks to an empty pair and the spin row
// defaults take over.
function schemaRange(settings, key) {
    const [, [min, max]] = settings.settings_schema.get_key(key).get_range().recursiveUnpack();
    return {min, max};
}

export function createShapeGroup(settings, radiusKey, borderWidthKey) {
    const group = new Adw.PreferencesGroup({title: _('Shape')});
    group.add(createSpinRow(_('Corner Radius (px)'), settings, radiusKey, 0, MAX_BORDER_RADIUS_PX));
    group.add(createSpinRow(_('Border Width (px)'), settings, borderWidthKey, 0, MAX_BORDER_WIDTH_PX));
    return group;
}

// Tab-style buttons for a two-or-three-way choice, where a dropdown would
// hide the options behind a click.
export function createSegmentedRow(title, subtitle, settings, key, displayOptions, values, {negate = null} = {}) {
    const group = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
    displayOptions.forEach((label, i) => group.add(new Adw.Toggle({label, name: values[i]})));
    group.update_property([Gtk.AccessibleProperty.LABEL], [title]);

    _bindSelectionToSetting(group, settings, key, {
        signal: 'notify::active-name',
        getValue: w => w.active_name || null,
        setValue: (w, value) => (w.active_name = value),
    });

    const negateBtn = negate ? _createNegateButton(settings, negate, group, displayOptions) : null;

    return createActionRow(title, subtitle, {suffixWidgets: [negateBtn, group].filter(Boolean)});
}

function _createNegateButton(settings, {key, iconName, tooltip}, group, displayOptions) {
    const btn = createBoundToggleButton(settings, key, {iconName, tooltip});

    const sync = () => {
        const negated = settings.get_boolean(key);
        displayOptions.forEach((label, i) => {
            group.get_toggle(i).label = negated ? `-${label}` : label;
        });
    };
    connectScoped(group, settings, `changed::${key}`, sync);
    sync();

    return btn;
}

export function createColorRow(title, settings, key, options = {}) {
    const row = new Adw.ActionRow({title});
    const colorButton = createColorButton(settings, key, title);

    if (options.accentAware) {
        const sync = () => (colorButton.sensitive = !usesAccent(settings.get_string(key)));
        sync();
        connectScoped(colorButton, settings, `changed::${key}`, sync);
    }

    // Adw rows pack add_suffix() left-to-right, so the paint-bucket goes in
    // first to land left of the color swatch.
    if (options.variants) {
        const variants = options.variants;
        const variantBtn = createIconButton('bti-color-symbolic', {
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

export function createSwitchRow(title, subtitle, settings, key) {
    const row = new Adw.SwitchRow({
        title,
        subtitle: subtitle || '',
    });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function createCustomStyleSwitchGroup(settings, key) {
    const group = new Adw.PreferencesGroup({title: _('Style')});
    group.add(createSwitchRow(_('Custom Style'),
        _('Reveal colors, padding and margin controls below.'), settings, key));
    return group;
}

export function createSubpageRow(title, subtitle, window, SubpageClass, settings, {prefixIcon = null} = {}) {
    const row = createActionRow(title, subtitle, {
        prefixWidget: prefixIcon ? new Gtk.Image({icon_name: prefixIcon}) : null,
        suffixIcon: NEXT_ICON_NAME,
        onActivate: () => pushSubpage(window, new SubpageClass(window, settings)),
    });

    return row;
}

export function createIconPickerRow(title, settings, key, window, PickerClass, iconList, options = {}) {
    const iconPreview = new Gtk.Image({pixel_size: 24, valign: Gtk.Align.CENTER});
    applyPathIcon(iconPreview, settings.get_string(key), settings);

    const row = createActionRow(title, settings.get_string(key), {
        suffixWidgets: [iconPreview],
        suffixIcon: NEXT_ICON_NAME,
        onActivate: () => {
            const picker = new PickerClass(settings, key, iconList, null, null, options);
            picker.present(window);
        },
    });

    const updateRow = () => {
        const newVal = settings.get_string(key);
        row.set_subtitle(newVal);
        applyPathIcon(iconPreview, newVal, settings);
    };

    connectScoped(row, settings, `changed::${key}`, updateRow);

    return row;
}

export function createDialogGearButton(window, settings, DialogClass, dialogData, {flat = true, tooltip = _('Configure')} = {}) {
    return createIconButton(GEAR_ICON_NAME, {
        flat,
        tooltip_text: tooltip,
        callback: () => new DialogClass(window, settings, dialogData).present(window),
    });
}

export function createComplexActionRow(title, subtitle, settings, mainKey, displayOptions, values, window, AdvancedConfigClass, advancedConfigData, {flat = true} = {}) {
    const gearBtn = createDialogGearButton(window, settings, AdvancedConfigClass, advancedConfigData,
        {flat, tooltip: _('Configure advanced actions')});

    const dropdown = _createBoundDropdown(settings, mainKey, displayOptions, values,
        {flat, width: ACTION_DROPDOWN_WIDTH_PX, label: title});

    return _createWrapRow(title, subtitle, [gearBtn, dropdown]);
}

// Adw.SwitchRow packs its switch as the FIRST suffix, so a gear added
// afterwards lands right of it. Built by hand to keep the gear left of the
// control, the way the click rows sit.
export function createComplexSwitchRow(title, subtitle, settings, key, window, DialogClass, dialogData, {gearFollowsSwitch = true} = {}) {
    const gearBtn = createDialogGearButton(window, settings, DialogClass, dialogData);
    if (gearFollowsSwitch)
        settings.bind(key, gearBtn, 'sensitive', Gio.SettingsBindFlags.GET);

    const toggle = new Gtk.Switch();
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    toggle.update_property([Gtk.AccessibleProperty.LABEL], [title]);

    const row = createActionRow(title, subtitle, {suffixWidgets: [gearBtn, toggle], activatable: true});
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

export function createActionRow(title, subtitle, options = {}) {
    const {prefixIcon, prefixWidget, suffixIcon, suffixWidgets, headerSuffix, activatable, onActivate, badge} = options;

    const row = new Adw.ActionRow({
        title,
        subtitle: subtitle || '',
        activatable: activatable || !!onActivate,
    });

    if (onActivate)
        row.connect('activated', onActivate);

    if (prefixIcon)
        row.add_prefix(new Gtk.Image({icon_name: prefixIcon, pixel_size: 24, valign: Gtk.Align.CENTER}));

    if (prefixWidget)
        row.add_prefix(_centered(prefixWidget));

    const badges = [badge ?? []].flat();
    if (badges.length) {
        // A wrap box stacks the badges once the row narrows, a plain box
        // would keep them side by side and squeeze the title column.
        const badgeBox = new Adw.WrapBox({
            child_spacing: BADGE_GAP_PX,
            line_spacing: BADGE_GAP_PX,
            align: 1,
            valign: Gtk.Align.CENTER,
        });
        for (const b of badges)
            badgeBox.append(createBadge(b.text, {variant: b.variant}));
        row.add_suffix(badgeBox);
    }

    if (headerSuffix) {
        headerSuffix.valign = Gtk.Align.CENTER;
        row.add_suffix(headerSuffix);
    }

    for (const widget of suffixWidgets ?? [])
        row.add_suffix(_centered(widget));

    if (suffixIcon)
        row.add_suffix(new Gtk.Image({icon_name: suffixIcon, valign: Gtk.Align.CENTER}));

    return row;
}

export function createExpanderSection({title, subtitle, headerSuffix, experimental}) {
    const expander = new Adw.ExpanderRow({
        title,
        subtitle: subtitle || '',
    });

    if (headerSuffix)
        expander.add_suffix(_centered(headerSuffix));

    // Adw.ExpanderRow prepends its suffixes while Adw.ActionRow appends them,
    // so the badge has to go in last to land left of the header button
    if (experimental)
        attachBadge(expander, _('Experimental'));

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

// Hides whole groups instead of single rows, so a section switching off
// leaves the rows it does not own exactly where they were.
export function bindGroupsVisible(owner, settings, groups, isVisible, ...keys) {
    const sync = () => groups.forEach(group => (group.visible = isVisible()));
    keys.forEach(key => connectScoped(owner, settings, `changed::${key}`, sync));
    sync();
}

// The side spinners sit around a box sketch so each value reads as
// "pushes from here", which four stacked rows per group did not.
export function createSpacingGroup(settings, keyBase, {min = 0, max = 50, step = 1} = {}) {
    ensurePrefsCss();
    const group = new Adw.PreferencesGroup({title: _('Spacing')});

    const box = new Adw.WrapBox({
        child_spacing: SPACING_CARD_GAP_PX,
        line_spacing: SPACING_CARD_GAP_PX,
        // Stretch a lone wrapped card to the line width instead of leaving
        // it at its compact natural size next to empty space.
        justify: Adw.JustifyMode.FILL,
    });
    [
        {title: _('Margin'), kind: 'margin', highlight: 'outer'},
        {title: _('Padding'), kind: 'padding', highlight: 'inner'},
    ].forEach(({title, kind, highlight}) => {
        const keyPrefix = `${keyBase}-${kind}`;
        box.append(_createSpacingCard(settings,
            {title, keyPrefix, highlight, linkKey: spacingLinkKey(keyPrefix)},
            {min, max, step}));
    });
    group.add(box);

    return group;
}

function _createSpacingCard(settings, {title, keyPrefix, highlight, linkKey}, limits) {
    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 14,
        css_classes: ['card', 'bti-spacing-card'],
    });
    const header = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL});
    header.append(new Gtk.Label({
        label: title,
        halign: Gtk.Align.START,
        valign: Gtk.Align.CENTER,
        hexpand: true,
        css_classes: ['heading'],
    }));
    header.append(createLinkToggle(settings, linkKey));
    card.append(header);

    const grid = new Gtk.Grid({
        row_spacing: 10,
        column_spacing: SPACING_GRID_COLUMN_SPACING_PX,
        halign: Gtk.Align.CENTER,
        vexpand: true,
        valign: Gtk.Align.CENTER,
    });

    const sideLabels = {
        top: _('Top'),
        right: _('Right'),
        bottom: _('Bottom'),
        left: _('Left'),
    };
    for (const [side, [col, row]] of Object.entries(SPACING_SIDE_SLOTS)) {
        grid.attach(_createSideSpinButton(settings, `${keyPrefix}-${side}`,
            sideLabels[side], `${title} ${sideLabels[side]}`, limits), col, row, 1, 1);
    }

    grid.attach(_createSpacingSketch(highlight), 1, 1, 1, 1);

    card.append(grid);
    return card;
}

function _createSpacingSketch(highlight) {
    const outer = new Gtk.Box({
        css_classes: [highlight === 'outer' ? 'bti-spacing-highlight' : 'bti-spacing-plain'],
    });
    outer.append(new Gtk.Box({
        css_classes: [highlight === 'inner' ? 'bti-spacing-highlight' : 'bti-spacing-plain'],
        margin_top: 9,
        margin_bottom: 9,
        margin_start: 9,
        margin_end: 9,
        hexpand: true,
        vexpand: true,
    }));
    return outer;
}

function _createSideSpinButton(settings, key, label, accessibleLabel, {min, max, step}) {
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step}),
        halign: Gtk.Align.CENTER,
        // At entry width the two cards' natural sizes overflow the page
        // clamp and the wrap box stacks them even in a wide window. Two
        // chars cover the whole value range.
        width_chars: 2,
    });
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    // The visual arrangement carries the side for sighted users only.
    spin.update_property([Gtk.AccessibleProperty.LABEL], [accessibleLabel]);

    const cell = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 5});
    cell.append(spin);
    cell.append(new Gtk.Label({label, css_classes: ['caption', 'dim-label']}));
    return cell;
}

export function createIconColorRows(parent, settings, keyPrefix) {
    return [
        {title: _('Icon'),       key: `${keyPrefix}color`,            hoverKey: `${keyPrefix}hover-color`,            variantTitle: _('Icon Color')},
        {title: _('Background'), key: `${keyPrefix}background-color`, hoverKey: `${keyPrefix}hover-background-color`, variantTitle: _('Background Color')},
        {title: _('Border'),     key: `${keyPrefix}border-color`,     hoverKey: `${keyPrefix}hover-border-color`,     variantTitle: _('Border Color')},
    ].map(spec => createAccentColorRow(parent, settings, spec));
}

export function createAccentColorRow(parent, settings, {title, key, hoverKey = null, variantTitle}) {
    const items = [{type: 'accent', title: _('Use Accent Color'), key}];
    if (hoverKey) {
        items.push(
            {type: 'accent', title: _('Use Accent Color on Hover'), key: hoverKey},
            {type: 'color', title: _('Hover'), key: hoverKey, hiddenWhenAccent: hoverKey});
    }
    return createColorRow(title, settings, key, {
        parent,
        accentAware: true,
        variants: {title: variantTitle, items},
    });
}

function createAccentSwitchRow(title, settings, colorKey) {
    const row = new Adw.SwitchRow({title});
    let syncing = false;
    const sync = () => {
        syncing = true;
        row.active = usesAccent(settings.get_string(colorKey));
        syncing = false;
    };

    row.connect('notify::active', () => {
        if (syncing)
            return;
        const current = settings.get_string(colorKey);
        if (row.active) {
            settings.set_string(colorKey, accentValueKeeping(current));
            return;
        }
        // Nothing to come back to when the accent was set by hand or by a
        // migration that had no color to keep.
        const previous = colorBehindAccent(current);
        if (previous)
            settings.set_string(colorKey, previous);
        else
            settings.reset(colorKey);
    });

    sync();
    connectScoped(row, settings, `changed::${colorKey}`, sync);
    return row;
}

// A bare Gtk.DropDown announces no row title to screen readers, so unlike
// Adw.ComboRow it needs the label wired in by hand.
function _createBoundDropdown(settings, key, displayOptions, values, {flat = true, width = -1, label = null} = {}) {
    const dropdown = new Gtk.DropDown({
        model: new Gtk.StringList({strings: displayOptions}),
        valign: Gtk.Align.CENTER,
        width_request: width,
    });

    // The stylesheet has no flat variant for the dropdown node itself,
    // only the internal toggle button picks up button.flat styling.
    if (flat)
        dropdown.get_first_child().add_css_class('flat');

    if (label)
        dropdown.update_property([Gtk.AccessibleProperty.LABEL], [label]);

    _bindDropdownSelection(dropdown, settings, key, values);

    return dropdown;
}

function _bindDropdownSelection(widget, settings, key, values) {
    _bindSelectionToSetting(widget, settings, key, {
        signal: 'notify::selected',
        getValue: w => w.selected < values.length ? values[w.selected] : null,
        setValue: (w, value) => {
            const idx = values.indexOf(value);
            if (idx !== -1)
                w.selected = idx;
        },
    });
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

