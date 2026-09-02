import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PREFS_SIDEBAR_BREAKPOINT = 'max-width: 700sp';
const SIDEBAR_HEADER_ICON_PX = 40;

const _shells = new WeakMap();

export function setPrefsWindow(window, {pages, iconPath}) {
    // The prefs service checks visible_page after fillPreferencesWindow and
    // throws "Extension did not provide any UI" when the stock view is empty
    // (extensionPrefsDialog.js), so it gets a stub page it can see.
    window.add(new Adw.PreferencesPage());

    const stack = new Gtk.Stack({
        transition_type: Gtk.StackTransitionType.CROSSFADE,
        vexpand: true,
    });
    pages.forEach(page => stack.add_named(page, page.title));

    const rootPage = new Adw.NavigationPage({title: pages[0].title});
    const contentToolbar = new Adw.ToolbarView();
    const contentHeader = new Adw.HeaderBar();
    contentToolbar.add_top_bar(contentHeader);
    contentToolbar.set_content(stack);
    rootPage.set_child(contentToolbar);

    const navView = new Adw.NavigationView();
    navView.add(rootPage);

    const list = new Gtk.ListBox({
        css_classes: ['navigation-sidebar'],
        selection_mode: Gtk.SelectionMode.BROWSE,
    });
    pages.forEach(page => list.append(_createSidebarRow(page)));

    const sidebarBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    sidebarBox.append(new Gtk.ScrolledWindow({
        child: list,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vexpand: true,
    }));

    const sidebarToolbar = new Adw.ToolbarView();
    sidebarToolbar.set_content(sidebarBox);

    const splitView = new Adw.OverlaySplitView({
        sidebar: sidebarToolbar,
        content: navView,
    });
    sidebarBox.prepend(_createSidebarHeader(window.get_title(), iconPath, splitView));

    list.connect('row-selected', (_list, row) => {
        if (!row)
            return;
        const page = pages[row.get_index()];
        // Mapping the overlay re-emits the current selection, and that echo
        // closed the sidebar in the same dispatch it opened in. Only the
        // row-activated handler below may touch show-sidebar.
        if (stack.get_visible_child() === page)
            return;
        navView.pop_to_page(rootPage);
        stack.set_visible_child(page);
        rootPage.set_title(page.title);
    });
    list.connect('row-activated', () => {
        navView.pop_to_page(rootPage);
        if (splitView.collapsed)
            splitView.show_sidebar = false;
    });
    list.select_row(list.get_row_at_index(0));

    // Collapsing auto-hides the sidebar and un-collapsing brings it back
    // whatever the toggle did in between (AdwOverlaySplitView:pin-sidebar docs).
    const breakpoint = new Adw.Breakpoint({
        condition: Adw.BreakpointCondition.parse(PREFS_SIDEBAR_BREAKPOINT),
    });
    breakpoint.add_setter(splitView, 'collapsed', true);
    window.add_breakpoint(breakpoint);

    contentHeader.pack_start(_createSidebarToggle(splitView));

    pages.forEach(page => {
        if (page.headerActions)
            contentHeader.pack_end(page.headerActions);
    });
    const syncHeaderActions = () => {
        const active = stack.get_visible_child();
        pages.forEach(page => {
            if (page.headerActions)
                page.headerActions.visible = page === active;
        });
    };
    stack.connect('notify::visible-child', syncHeaderActions);
    syncHeaderActions();

    const overlay = new Adw.ToastOverlay({child: splitView});
    window.set_content(overlay);

    _shells.set(window, {navView, overlay, splitView});
}

export function pushSubpage(window, page) {
    _shells.get(window).navView.push(page);
}

export function popSubpage(window) {
    _shells.get(window).navView.pop();
}

export function addToast(window, toast) {
    _shells.get(window).overlay.add_toast(toast);
}

// Every surface that covers the root header bar, a subpage or the collapsed
// sidebar itself, needs a toggle of its own.
export function createSidebarToggle(window) {
    return _createSidebarToggle(_shells.get(window).splitView);
}

function _createSidebarToggle(splitView) {
    const button = new Gtk.ToggleButton({css_classes: ['flat']});
    splitView.bind_property('show-sidebar', button, 'active',
        GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);
    // Expanded, the sidebar is a fixed pane and the button has no job.
    splitView.bind_property('collapsed', button, 'visible', GObject.BindingFlags.SYNC_CREATE);

    const sync = () => {
        button.icon_name = button.active ? 'bti-sidebar-hide-symbolic' : 'bti-sidebar-show-symbolic';
        button.tooltip_text = button.active ? _('Hide Sidebar') : _('Show Sidebar');
    };
    button.connect('notify::active', sync);
    sync();

    return button;
}

function _createSidebarHeader(title, iconPath, splitView) {
    const box = new Gtk.Box({
        spacing: 12,
        margin_top: 18,
        margin_bottom: 14,
        margin_start: 12,
        margin_end: 12,
    });
    try {
        // A Gtk.Image would shrink the texture back to icon size, and a picture
        // fed the raw file would inflate the header bar.
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
            iconPath, SIDEBAR_HEADER_ICON_PX, SIDEBAR_HEADER_ICON_PX, true);
        box.append(new Gtk.Picture({paintable: Gdk.Texture.new_for_pixbuf(pixbuf)}));
    } catch { /* The text still names the sidebar */ }
    const labels = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER});
    labels.append(new Gtk.Label({label: title, halign: Gtk.Align.START, css_classes: ['heading']}));
    labels.append(new Gtk.Label({label: _('Settings'), halign: Gtk.Align.START, css_classes: ['caption', 'dim-label']}));
    box.append(labels);

    const collapse = _createSidebarToggle(splitView);
    collapse.hexpand = true;
    collapse.halign = Gtk.Align.END;
    collapse.valign = Gtk.Align.CENTER;
    box.append(collapse);

    return box;
}

function _createSidebarRow(page) {
    const box = new Gtk.Box({
        spacing: 12,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 6,
        margin_end: 6,
    });
    box.append(new Gtk.Image({icon_name: page.icon_name}));
    box.append(new Gtk.Label({label: page.title}));
    return new Gtk.ListBoxRow({child: box});
}
