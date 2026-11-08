import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ensurePrefsCss} from './text.js';

const BADGE_GAP_PX = 6;

// Adw.WrapBox aligns a line from 0 (start) to 1 (end).
const WRAP_BOX_ALIGN_START = 0;
const WRAP_BOX_ALIGN_END = 1;

// Adw.SwitchRow and friends put their own control in as the first suffix, so
// an appended badge lands right of it. Pulling the control out and back is the
// only way around that without touching the row's private children.
export function attachBadge(row, badges) {
    if (![badges].flat().some(Boolean))
        return null;

    const box = createBadgeBox(badges);

    const actionWidget = row.get_activatable_widget?.();
    if (actionWidget) {
        row.remove(actionWidget);
        row.add_suffix(box);
        row.add_suffix(actionWidget);
        row.set_activatable_widget(actionWidget);
    } else {
        row.add_suffix(box);
    }
    return box;
}

export function createBadgeBox(badges) {
    const box = new Adw.WrapBox({
        child_spacing: BADGE_GAP_PX,
        line_spacing: BADGE_GAP_PX,
        align: WRAP_BOX_ALIGN_END,
        valign: Gtk.Align.CENTER,
    });
    setBadges(box, badges);
    return box;
}

// A line under a row's text. It keeps one badge's height while empty, so rows
// with and without badges stay the same height.
export function createBadgeLine(badges) {
    const box = createBadgeBox(badges);
    box.align = WRAP_BOX_ALIGN_START;
    box.halign = Gtk.Align.START;
    box.height_request = badgeHeight();
    return box;
}

let _badgeHeight = 0;
function badgeHeight() {
    if (!_badgeHeight)
        [, _badgeHeight] = createBadge({text: 'X'}).measure(Gtk.Orientation.VERTICAL, -1);
    return _badgeHeight;
}

export function setBadges(box, badges) {
    box.remove_all();
    for (const entry of [badges].flat().filter(Boolean))
        box.append(createBadge(entry));
}

export function createBadge({text, variant}) {
    ensurePrefsCss();
    const label = new Gtk.Label({
        label: text,
        valign: Gtk.Align.CENTER,
    });
    label.set_css_classes(badgeCssClasses(variant));
    return label;
}

export function badgeCssClasses(variant = 'warning') {
    return variant === 'warning' ? ['bti-badge'] : ['bti-badge', variant];
}
