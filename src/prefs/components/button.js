import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';
import {GEAR_ICON_NAME} from './icon.js';
import {ALIGN_PROPS, alignFor} from './text.js';

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

    const sync = () => {
        const active = isActive();
        button.icon_name = active ? activeIconName : iconName;
        button.tooltip_text = active ? activeTooltip : tooltip;
        button.update_property([Gtk.AccessibleProperty.LABEL], [button.tooltip_text]);
    };
    button.connect('clicked', () => {
        onToggle();
        sync();
    });
    if (settings)
        connectScoped(button, settings, `changed::${key}`, sync);
    sync();
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
