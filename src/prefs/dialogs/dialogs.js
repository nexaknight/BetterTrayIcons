import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {addConfigRows} from '../widgets/rows.js';

export const ENTRY_DEBOUNCE_MS = 300;

const STYLE_DIALOG_WIDTH_PX = 420;

const TEXT_DIALOG_WIDTH_PX = 600;

export function showConfirmationDialog(parent, title, message, onConfirm, confirmLabel, isDestructive = false, onCancel = null) {
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
        isDestructive ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.SUGGESTED
    );

    dialog.connect('response', (_d, response) => {
        if (response === 'confirm')
            onConfirm();
        else
            onCancel?.();
    });

    dialog.present(parent);
}

export function openFileChooser(parent, options, callback) {
    const dialog = new Gtk.FileDialog({
        title: options.title || _('File Chooser'),
        accept_label: options.acceptLabel || null,
        modal: true,
    });

    if (options.filters) {
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        options.filters.forEach(f => filters.append(f));
        dialog.set_filters(filters);
        dialog.set_default_filter(options.filters[0]);
    }

    if (options.currentName)
        dialog.set_initial_name(options.currentName);

    const action = options.action || 'open';
    const onFinish = (d, res, finishMethod) => {
        try {
            const file = d[finishMethod](res);
            if (file)
                callback(file.get_path());
        } catch (e) {
            if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                error('FileDialog failed', e);
        }
    };

    switch (action) {
    case 'save':
        dialog.save(parent, null, (d, res) => onFinish(d, res, 'save_finish'));
        break;
    case 'select_folder':
        dialog.select_folder(parent, null, (d, res) => onFinish(d, res, 'select_folder_finish'));
        break;
    default:
        dialog.open(parent, null, (d, res) => onFinish(d, res, 'open_finish'));
        break;
    }
}

export function openUri(parent, uri) {
    const launcher = new Gtk.UriLauncher({uri});
    launcher.launch(parent, null, null);
}

// The dialog sizes to its natural height, which is what lets a row list
// grow instead of being cut off by a fixed content_height. The caller
// still pins a width through pinDialogWidth, the natural width would
// collapse to the narrowest wrap otherwise.
export function dialogSizeProps() {
    return {follows_content_size: true};
}

// The banner label wraps but caps no max-width-chars (adw-banner.ui), so its
// natural width is the full unwrapped sentence (measured 861px) and a
// follows-content-size dialog grows toward it. The banner also allocates the
// label at its natural width, so the cap needs enough room to read.
const BANNER_TITLE_MAX_CHARS = 40;

export function createCappedBanner(title, props = {}) {
    const banner = new Adw.Banner({title, ...props});
    _findLabel(banner)?.set_max_width_chars(BANNER_TITLE_MAX_CHARS);
    return banner;
}

// A graceful no-op if a future libadwaita restructures the banner.
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

// Raises only the NATURAL width: a size request would also raise the
// minimum, and a dialog whose content cannot shrink clips at the window
// edge. With the minimum untouched the floating sheet re-clamps natural
// against the available space on every allocation, so the dialog renders
// at the intended width whenever the window allows and follows it down
// and back up otherwise. A layout manager because GTK never calls the
// measure vfunc of a widget that has one, and Adw.Bin has.
const NaturalWidthLayout = GObject.registerClass({GTypeName: 'BetterTrayIconsNaturalWidthLayout'},
    class NaturalWidthLayout extends Gtk.LayoutManager {
        // The content is wrapping labels, the default CONSTANT_SIZE would
        // have callers measure heights at unwrapped widths.
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
                nat = Math.max(nat, widget.naturalWidth ?? 0);
            return [min, nat, -1, -1];
        }

        vfunc_allocate(widget, width, height, baseline) {
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
                child.allocate(width, height, baseline, null);
        }
    });

// Floating keeps the dialog vertically centered at every window size,
// the automatic mode would dock it to the bottom as a sheet instead.
export function pinDialogWidth(dialog, width) {
    dialog.presentation_mode = Adw.DialogPresentationMode.FLOATING;
    const bin = new Adw.Bin({layout_manager: new NaturalWidthLayout()});
    bin.naturalWidth = width;
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
    if (overlay) {
        overlay.set_child(page);
        toolbarView.set_content(overlay);
    } else {
        toolbarView.set_content(page);
    }

    return {toolbarView, headerBar, page, toast: overlay};
}

export function showTextDialog(parent, title, content, width = TEXT_DIALOG_WIDTH_PX) {
    const {group, present} = buildGroupDialog({title, width});

    // A selectable or focusable label takes the dialog's initial focus, which
    // highlights everything and scrolls to the last link. Links still work
    // without it.
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

export function openStyleDialog(parentWindow, settings, {title, description = '', items = []} = {}) {
    const {group, present} = buildGroupDialog({
        title: title || _('Style'),
        width: STYLE_DIALOG_WIDTH_PX,
        groupTitle: title || _('Style'),
        groupDescription: description,
    });

    addConfigRows(group, settings, items);
    present(parentWindow);
}

export function buildGroupDialog({title, width, groupTitle = '', groupDescription = ''}) {
    const {toolbarView, page} = buildDialogShell();

    const group = new Adw.PreferencesGroup({title: groupTitle, description: groupDescription});
    page.add(group);

    const dialog = new Adw.Dialog({
        title,
        ...dialogSizeProps(),
        child: toolbarView,
    });
    pinDialogWidth(dialog, width);

    return {group, present: parent => dialog.present(parent)};
}
