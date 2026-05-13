import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {createColorButton} from '../widgets/gtkHelpers.js';

export function showConfirmationDialog(parent, title, message, onConfirm, confirmLabel, isDestructive = false) {
    const dialog = new Adw.AlertDialog({
        heading: title,
        body: message,
        default_response: 'cancel',
        close_response: 'cancel',
    });

    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('confirm', confirmLabel || _('Confirm'));
    dialog.set_response_appearance(
        'confirm',
        isDestructive ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.SUGGESTED
    );

    dialog.connect('response', (_d, response) => {
        if (response === 'confirm')
            onConfirm();
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

export function showTextDialog(parent, title, content, width = 600, height = 500) {
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(new Adw.HeaderBar());

    const page = new Adw.PreferencesPage();
    toolbarView.set_content(page);

    const group = new Adw.PreferencesGroup();
    page.add(group);

    group.add(new Gtk.Label({
        label: content,
        use_markup: true,
        wrap: true,
        xalign: 0,
        margin_top: 12, margin_bottom: 12,
        margin_start: 12, margin_end: 12,
        selectable: true,
    }));

    const dialog = new Adw.Dialog({
        title,
        content_width: width,
        content_height: height,
        child: toolbarView,
    });
    dialog.present(parent);
}

export function openStyleDialog(parentWindow, settings, {title, description = '', items = []} = {}) {
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(new Adw.HeaderBar());

    const page = new Adw.PreferencesPage();
    toolbarView.set_content(page);

    const group = new Adw.PreferencesGroup({
        title: title || _('Style'),
        description,
    });
    page.add(group);

    items.forEach(item => {
        if (item.type === 'color' && item.key) {
            const row = new Adw.ActionRow({title: item.title});
            row.add_suffix(createColorButton(settings, item.key, item.title));
            group.add(row);
        }
    });

    const dialog = new Adw.Dialog({
        title: title || _('Style'),
        content_width: 420,
        child: toolbarView,
    });
    dialog.present(parentWindow);
}
