import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {BORDER_RADIUS_MAX_PX, BORDER_WIDTH_MAX_PX} from '../../const.js';
import {createLinkToggle} from './button.js';
import {createSpinRow, createSwitchRow} from './row.js';
import {spacingLinkKey} from './spacing.js';
import {ensurePrefsCss} from './text.js';

// Grid slots around the spacing card's center sketch, column/row per side.
const SPACING_SIDE_SLOTS = Object.freeze({
    top: [1, 0], right: [2, 1], bottom: [1, 2], left: [0, 1],
});

const SPACING_MAX_PX = 50;

// AdwClamp caps page content at 600sp whatever the window width, leaving the
// group below about 576sp. Without these trims the two spacing cards wrap in a
// window with plenty of visible room to spare.
const SPACING_GRID_COLUMN_SPACING_PX = 6;
const SPACING_CARD_GAP_PX = 8;

export function createShapeGroup({settings, radiusKey, borderWidthKey}) {
    const group = new Adw.PreferencesGroup({title: _('Shape')});
    group.add(createSpinRow({
        title: _('Corner Radius (px)'),
        settings,
        key: radiusKey,
        max: BORDER_RADIUS_MAX_PX,
    }));
    group.add(createSpinRow({
        title: _('Border Width (px)'),
        settings,
        key: borderWidthKey,
        max: BORDER_WIDTH_MAX_PX,
    }));
    return group;
}

export function createCustomStyleSwitchGroup({settings, key}) {
    const group = new Adw.PreferencesGroup({title: _('Style')});
    group.add(createSwitchRow({
        title: _('Custom Style'),
        subtitle: _('Reveal colors, padding and margin controls below.'),
        settings,
        key,
    }));
    return group;
}

export function createSpacingGroup({settings, keyBase}) {
    ensurePrefsCss();
    const group = new Adw.PreferencesGroup({title: _('Spacing')});

    const box = new Adw.WrapBox({
        child_spacing: SPACING_CARD_GAP_PX,
        line_spacing: SPACING_CARD_GAP_PX,
        // Stretches the first card to the line width once the two wrap. The
        // last line is never justified, so the second card stays natural.
        justify: Adw.JustifyMode.FILL,
    });
    [
        {cardTitle: _('Margin'), kind: 'margin', highlight: 'outer'},
        {cardTitle: _('Padding'), kind: 'padding', highlight: 'inner'},
    ].forEach(({cardTitle, kind, highlight}) => {
        const keyPrefix = `${keyBase}-${kind}`;
        box.append(_createSpacingCard(settings,
            {title: cardTitle, keyPrefix, highlight, linkKey: spacingLinkKey(keyPrefix)}));
    });
    group.add(box);

    return group;
}

function _createSpacingCard(settings, {title, keyPrefix, highlight, linkKey}) {
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
            sideLabels[side], `${title} ${sideLabels[side]}`), col, row, 1, 1);
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

function _createSideSpinButton(settings, key, label, accessibleLabel) {
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({lower: 0, upper: SPACING_MAX_PX, step_increment: 1}),
        halign: Gtk.Align.CENTER,
        // Two chars cover the whole value range, at entry width the two cards
        // overflow the page clamp and the wrap box stacks them.
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
