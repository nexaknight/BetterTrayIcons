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
const HELP_TEXT_MAX_CHARS = 40;
const HELP_TEXT_MARGIN_PX = 6;

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

    const button = createButton({iconName, cssClasses: classes, valign: 'center', onClick, ...props});
    if (tooltip)
        button.tooltip_text = tooltip;
    return button;
}

export function createActionButton({
    iconName,
    tooltip,
    onClick = null,
    activeIconName = null,
    activeTooltip = tooltip,
    settings = null,
    key = null,
    isActive = () => settings.get_boolean(key),
    onToggle = () => settings.set_boolean(key, !settings.get_boolean(key)),
}) {
    const button = createIconButton(iconName, {tooltip, onClick});
    button.update_property([Gtk.AccessibleProperty.LABEL], [tooltip]);
    if (!activeIconName)
        return button;

    ensurePrefsCss();
    const sync = () => {
        const active = isActive();
        button.icon_name = active ? activeIconName : iconName;
        button.tooltip_text = active ? activeTooltip : tooltip;
        button.update_property([Gtk.AccessibleProperty.LABEL], [button.tooltip_text]);
        if (active)
            button.add_css_class(ACTIVE_ACTION_CLASS);
        else
            button.remove_css_class(ACTIVE_ACTION_CLASS);
    };
    button.connect('clicked', () => {
        onToggle();
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
    const button = new Gtk.ToggleButton({css_classes: ['flat'], valign: Gtk.Align.CENTER});
    if (iconName)
        button.icon_name = iconName;
    if (tooltip)
        button.tooltip_text = tooltip;

    settings.bind(key, button, 'active', Gio.SettingsBindFlags.DEFAULT);
    return button;
}

// A popover and no tooltip, a tooltip never shows on touch and would cover
// the popover with the same text.
export function createHelpButton(text, {compact = false} = {}) {
    const label = new Gtk.Label({
        label: text,
        wrap: true,
        max_width_chars: HELP_TEXT_MAX_CHARS,
        xalign: 0,
        margin_top: HELP_TEXT_MARGIN_PX,
        margin_bottom: HELP_TEXT_MARGIN_PX,
        margin_start: HELP_TEXT_MARGIN_PX,
        margin_end: HELP_TEXT_MARGIN_PX,
    });
    const button = new Gtk.MenuButton({
        icon_name: HELP_ICON_NAME,
        popover: new Gtk.Popover({child: label}),
        has_frame: false,
        css_classes: compact ? ['circular', HELP_COMPACT_CLASS] : ['circular'],
        valign: Gtk.Align.CENTER,
    });
    button.update_property([Gtk.AccessibleProperty.LABEL], [_('Help')]);
    return button;
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
