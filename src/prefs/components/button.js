import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {watchKeys} from '../../shared/lifecycle.js';
import {GEAR_ICON_NAME} from './icon.js';
import {ALIGN_PROPS, alignFor, ensurePrefsCss} from './text.js';

const ACTIVE_ACTION_CLASS = 'bti-action-active';

const MENU_ITEM_GAP_PX = 8;

const HELP_ICON_NAME = 'bti-help-symbolic';
const HELP_COMPACT_CLASS = 'bti-help-compact';
const HELP_POPOVER_CLASS = 'bti-help-popover';
// The website demo wraps its help text here, 340px less 22px inset per side
const HELP_TEXT_WIDTH_PX = 296;

export function createButton({label, iconName, cssClasses = [], onClick = null, ...props}) {
    for (const key of ALIGN_PROPS) {
        if (props[key])
            props[key] = alignFor(props[key]);
    }

    const params = {valign: Gtk.Align.CENTER, ...props};
    if (label !== undefined)
        params.label = label;
    if (iconName !== undefined)
        params.icon_name = iconName;
    const button = new Gtk.Button(params);
    if (cssClasses.length > 0)
        button.set_css_classes(cssClasses);
    if (onClick)
        button.connect('clicked', onClick);
    return button;
}

export function createIconButton(iconName, {circular = true, flat = true, extraClasses = [], tooltip = null, onClick = null, ...props} = {}) {
    const classes = [];
    if (flat)
        classes.push('flat');
    if (circular)
        classes.push('circular');
    classes.push(...extraClasses);

    return createButton({iconName, cssClasses: classes, valign: 'center', onClick, tooltip_text: tooltip, ...props});
}

export function createActionButton({
    iconName,
    tooltip,
    onClick = null,
    activeIconName = null,
    activeTooltip = tooltip,
    settings = null,
    key = null,
}) {
    const button = createIconButton(iconName, {tooltip, onClick});
    button.update_property([Gtk.AccessibleProperty.LABEL], [tooltip]);
    if (!activeIconName)
        return button;

    ensurePrefsCss();
    const sync = () => {
        const isActive = settings.get_boolean(key);
        button.icon_name = isActive ? activeIconName : iconName;
        button.tooltip_text = isActive ? activeTooltip : tooltip;
        button.update_property([Gtk.AccessibleProperty.LABEL], [button.tooltip_text]);
        if (isActive)
            button.add_css_class(ACTIVE_ACTION_CLASS);
        else
            button.remove_css_class(ACTIVE_ACTION_CLASS);
    };
    button.connect('clicked', () => {
        settings.set_boolean(key, !settings.get_boolean(key));
        sync();
    });
    watchKeys(button, settings, [key], sync);
    return button;
}

// A Gtk.PopoverMenu built from a Gio.Menu drops item icons, so the items are
// plain buttons in a popover that wears the stock menu class.
export function createMenuButton({iconName, tooltip, items}) {
    ensurePrefsCss();
    const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['bti-menu-list']});
    const popover = new Gtk.Popover({child: list, css_classes: ['menu']});
    for (const item of items) {
        const content = new Gtk.Box({spacing: MENU_ITEM_GAP_PX});
        content.append(new Gtk.Image({icon_name: item.iconName}));
        content.append(new Gtk.Label({label: item.label}));
        list.append(createButton({
            child: content,
            cssClasses: ['flat', 'bti-menu-item'],
            valign: 'fill',
            onClick: () => {
                popover.popdown();
                item.onActivate();
            },
        }));
    }

    const button = new Gtk.MenuButton({
        icon_name: iconName,
        popover,
        tooltip_text: tooltip,
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
    });
    button.update_property([Gtk.AccessibleProperty.LABEL], [tooltip]);
    return button;
}

export function createDialogGearButton({window, settings, DialogClass, dialogData, tooltip = _('Configure')}) {
    return createIconButton(GEAR_ICON_NAME, {
        tooltip,
        onClick: () => new DialogClass(window, settings, dialogData).present(window),
    });
}

export function createBoundToggleButton(settings, key, {iconName = null, tooltip = null} = {}) {
    const button = new Gtk.ToggleButton({css_classes: ['flat'], valign: Gtk.Align.CENTER, tooltip_text: tooltip});
    if (iconName)
        button.icon_name = iconName;

    settings.bind(key, button, 'active', Gio.SettingsBindFlags.DEFAULT);
    return button;
}

// A popover and no tooltip, a tooltip never shows on touch and would cover
// the popover with the same text.
export function createHelpButton(text, {compact = false} = {}) {
    ensurePrefsCss();
    // The clamp caps long text and lets short text keep its own width, a
    // character count on the label could only guess the pixels
    const popover = new Gtk.Popover({
        child: new Adw.Clamp({
            child: new Gtk.Label({label: text, wrap: true, xalign: 0}),
            maximum_size: HELP_TEXT_WIDTH_PX,
            unit: Adw.LengthUnit.PX,
        }),
        has_arrow: false,
        autohide: false,
        halign: Gtk.Align.START,
        css_classes: [HELP_POPOVER_CLASS],
    });
    const button = new Gtk.MenuButton({
        icon_name: HELP_ICON_NAME,
        popover,
        has_frame: false,
        css_classes: compact ? ['circular', HELP_COMPACT_CLASS] : ['circular'],
        valign: Gtk.Align.CENTER,
    });
    button.update_property([Gtk.AccessibleProperty.LABEL], [_('Help')]);
    _closeOnOutsideInput(popover, button);
    return button;
}

// Autohide grabs the pointer, so the page under the popover could not
// scroll. Without it a press, a scroll or Escape elsewhere closes the
// popover and still reaches its own target, as on the website demo.
function _closeOnOutsideInput(popover, button) {
    const isOutside = controller => popover.visible &&
        controller.get_current_event().get_surface() !== popover.get_surface();
    const capture = {propagation_phase: Gtk.PropagationPhase.CAPTURE};

    const press = new Gtk.GestureClick({button: 0, ...capture});
    press.connect('pressed', (gesture, _nPress, x, y) => {
        if (!isOutside(gesture))
            return;
        // The button closes the popover itself, closing it here first would
        // let its release open it again
        const target = button.get_root().pick(x, y, Gtk.PickFlags.DEFAULT);
        if (target !== button && !target.is_ancestor(button))
            popover.popdown();
    });

    const scroll = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.BOTH_AXES, ...capture});
    scroll.connect('scroll', controller => {
        if (isOutside(controller))
            popover.popdown();
        return Gdk.EVENT_PROPAGATE;
    });

    const keys = new Gtk.EventControllerKey(capture);
    keys.connect('key-pressed', (_controller, keyval) => {
        if (keyval !== Gdk.KEY_Escape || !popover.visible)
            return Gdk.EVENT_PROPAGATE;
        popover.popdown();
        return Gdk.EVENT_STOP;
    });

    // These handlers close the popover while GTK walks the root's
    // controllers, removing one on close would free it mid-walk and crash.
    // The button's map and unmap never fire inside that walk.
    const controllers = [press, scroll, keys];
    let root = null;
    button.connect('map', () => {
        root = button.get_root();
        controllers.forEach(controller => root.add_controller(controller));
    });
    button.connect('unmap', () => controllers.forEach(controller => root.remove_controller(controller)));
}

export function createLinkToggle(settings, linkKey) {
    const button = createBoundToggleButton(settings, linkKey);

    const sync = () => {
        button.icon_name = button.active ? 'bti-link-symbolic' : 'bti-unlink-symbolic';
        button.tooltip_text = button.active
            ? _('Unlink: edit each side on its own')
            : _('Link: editing one side sets all four');
    };
    button.connect('notify::active', sync);
    sync();

    return button;
}
