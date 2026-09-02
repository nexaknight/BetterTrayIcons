import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ensurePrefsCss} from './text.js';

const BADGE_GAP_PX = 6;

// Adw.WrapBox aligns a line from 0 (start) to 1 (end).
const WRAP_BOX_ALIGN_END = 1;

// Adw.SwitchRow and friends put their own control in as the first suffix, so
// an appended badge lands right of it. Pulling the control out and back is the
// only way around that without touching the row's private children.
export function attachBadge(row, badges) {
    const entries = [badges].flat().filter(Boolean);
    if (!entries.length)
        return null;

    const box = new Adw.WrapBox({
        child_spacing: BADGE_GAP_PX,
        line_spacing: BADGE_GAP_PX,
        align: WRAP_BOX_ALIGN_END,
        valign: Gtk.Align.CENTER,
    });
    for (const entry of entries)
        box.append(createBadge(entry));

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

function createBadge({text, variant = 'warning'}) {
    ensurePrefsCss();
    const label = new Gtk.Label({
        label: text,
        valign: Gtk.Align.CENTER,
    });
    const classes = ['bti-badge'];
    if (variant !== 'warning')
        classes.push(variant);
    label.set_css_classes(classes);
    return label;
}
