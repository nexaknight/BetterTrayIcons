import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {bindNarrowWindow} from './sidebar.js';

export const ENTRY_DEBOUNCE_MS = 300;

const TEXT_DIALOG_WIDTH_PX = 600;

// The banner label wraps but sets no max-width-chars (adw-banner.ui), so its
// natural width is the whole unwrapped sentence and a follows-content-size
// dialog grows toward it.
const BANNER_TITLE_MAX_CHARS = 40;

export function showConfirmationDialog(parent, {title, message, confirmLabel, destructive = false, onConfirm}) {
    const dialog = new Adw.AlertDialog({
        heading: title,
        body: message,
        default_response: 'cancel',
        close_response: 'cancel',
    });

    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('confirm', confirmLabel);
    dialog.set_response_appearance(
        'confirm',
        destructive ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.SUGGESTED
    );

    dialog.connect('response', (_d, response) => {
        if (response === 'confirm')
            onConfirm();
    });

    dialog.present(parent);
}

export function openFileChooser(parent, {title, action = 'open', acceptLabel = null, currentName = null, filters, onDismiss = null}, callback) {
    const dialog = new Gtk.FileDialog({
        title,
        accept_label: acceptLabel,
        modal: true,
    });

    const filterStore = new Gio.ListStore({item_type: Gtk.FileFilter});
    filters.forEach(filter => filterStore.append(filter));
    dialog.set_filters(filterStore);
    dialog.set_default_filter(filters[0]);

    if (currentName)
        dialog.set_initial_name(currentName);

    const onFinish = (d, res, finishMethod) => {
        try {
            callback(d[finishMethod](res).get_path());
        } catch (e) {
            if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                error('FileDialog failed', e);
            onDismiss?.();
        }
    };

    switch (action) {
    case 'save':
        dialog.save(parent, null, (d, res) => onFinish(d, res, 'save_finish'));
        break;
    default:
        dialog.open(parent, null, (d, res) => onFinish(d, res, 'open_finish'));
        break;
    }
}

export function createFileFilter(name, patterns, mimeTypes = []) {
    const filter = new Gtk.FileFilter();
    filter.set_name(name);
    patterns.forEach(p => filter.add_pattern(p));
    mimeTypes.forEach(m => filter.add_mime_type(m));
    return filter;
}

// A size request would raise the minimum too and a dialog whose content cannot
// shrink clips at the window edge, so only the natural width goes up. GTK skips
// the measure vfunc of a widget with a layout manager, and Adw.Bin has one.
const NaturalWidthLayout = GObject.registerClass({GTypeName: 'BetterTrayIconsNaturalWidthLayout'},
    class NaturalWidthLayout extends Gtk.LayoutManager {
        // The content is wrapping labels, the default CONSTANT_SIZE would have
        // callers measure heights at unwrapped widths.
        vfunc_get_request_mode(widget) {
            return widget.child?.get_request_mode() ?? Gtk.SizeRequestMode.CONSTANT_SIZE;
        }

        vfunc_measure(widget, orientation, forSize) {
            let min = 0;
            let nat = 0;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
                const [childMin, childNat] = child.measure(orientation, forSize);
                min = Math.max(min, childMin);
                nat = Math.max(nat, childNat);
            }
            if (orientation === Gtk.Orientation.HORIZONTAL)
                nat = Math.max(nat, widget.isFullWidth ? widget.get_root().get_width() : widget.naturalWidth);
            return [min, nat, -1, -1];
        }

        vfunc_allocate(widget, width, height, baseline) {
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
                child.allocate(width, height, baseline, null);
        }
    });

// Floating keeps the dialog vertically centered at every window size,
// the automatic mode would dock it to the bottom as a sheet instead. In a
// narrow window the dialog asks for the whole width so its rows don't squeeze.
export function pinDialogWidth(dialog, width) {
    dialog.presentation_mode = Adw.DialogPresentationMode.FLOATING;
    const bin = new Adw.Bin({layout_manager: new NaturalWidthLayout()});
    bin.naturalWidth = width;
    bin.isFullWidth = false;
    const setFullWidth = isNarrow => {
        bin.isFullWidth = isNarrow;
        bin.queue_resize();
    };
    const mapId = bin.connect('map', () => {
        bin.disconnect(mapId);
        setFullWidth(bindNarrowWindow(bin.get_root(), bin, setFullWidth));
    });
    const child = dialog.child;
    dialog.child = null;
    bin.child = child;
    dialog.child = bin;
}

export function buildDialogShell({toast = false} = {}) {
    const toolbarView = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar();
    toolbarView.add_top_bar(headerBar);

    const page = new Adw.PreferencesPage();
    const overlay = toast ? new Adw.ToastOverlay() : null;
    overlay?.set_child(page);
    toolbarView.set_content(overlay ?? page);

    return {toolbarView, headerBar, page, toast: overlay};
}

export function showTextDialog(parent, {title, content}) {
    const {group, present} = buildGroupDialog({title, width: TEXT_DIALOG_WIDTH_PX});

    // A selectable or focusable label takes the dialog's initial focus, which
    // highlights everything and scrolls to the last link. Links still work.
    group.add(new Gtk.Label({
        label: content,
        use_markup: true,
        wrap: true,
        xalign: 0,
        margin_top: 12, margin_bottom: 12,
        margin_start: 12, margin_end: 12,
        focusable: false,
    }));

    present(parent);
}

// With tabs the header shows a switcher where the title was, and each tab
// gets a page and a group of its own, in the order of the labels.
export function buildGroupDialog({title, width, groupTitle = '', tabs = []}) {
    const {toolbarView, headerBar, page} = buildDialogShell();
    const groups = tabs.length
        ? _addTabs(toolbarView, headerBar, tabs)
        : [_addGroup(page, groupTitle)];

    const dialog = new Adw.Dialog({
        title,
        follows_content_size: true,
        child: toolbarView,
    });
    pinDialogWidth(dialog, width);

    return {group: groups[0], groups, present: parent => dialog.present(parent)};
}

function _addGroup(page, title) {
    const group = new Adw.PreferencesGroup({title});
    page.add(group);
    return group;
}

function _addTabs(toolbarView, headerBar, labels) {
    const stack = new Adw.ViewStack();
    const switcher = new Adw.ToggleGroup();
    const groups = labels.map((label, i) => {
        const name = `tab-${i}`;
        const page = new Adw.PreferencesPage();
        stack.add_named(page, name);
        switcher.add(new Adw.Toggle({name, label}));
        return _addGroup(page, '');
    });
    switcher.bind_property('active-name', stack, 'visible-child-name', GObject.BindingFlags.SYNC_CREATE);
    headerBar.title_widget = switcher;
    toolbarView.content = stack;
    return groups;
}

export function createCappedBanner(title, props = {}) {
    const banner = new Adw.Banner({title, ...props});
    _findLabel(banner)?.set_max_width_chars(BANNER_TITLE_MAX_CHARS);
    return banner;
}

function _findLabel(widget) {
    if (widget instanceof Gtk.Label)
        return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const label = _findLabel(child);
        if (label)
            return label;
    }
    return null;
}
