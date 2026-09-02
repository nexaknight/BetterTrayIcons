import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {clearIds, debounceTo, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed, trackDisposal} from '../disposal.js';
import {computeToggleStyle, applyPanelClasses} from '../trayStyle.js';
import {createPanelMenu, destroyMenuSafely} from '../popupMenus.js';
import {ClickController} from '../features/clickController.js';

const HOVER_MENU_ACTION = 'action-menu';
const SCROLL_ACTION_CYCLE = 'cycle';

export class ToggleButton {
    constructor(settings, {openPreferences, cycleIcons}) {
        this._settings = settings;
        this._openPreferences = openPreferences;
        this._cycleIcons = cycleIcons;
        this._overflowMenu = null;
        this._actionMenu = null;
        this._actionMenuOverflowItem = null;
        this._hoverOrderId = 0;

        this._icon = new St.Icon({
            icon_name: this._settings.get_string('toggle-icon-name'),
            style_class: 'system-status-icon',
        });
        this._icon.set_pivot_point(0.5, 0.5);
        this._iconAngle = 0;

        this.actor = new St.Button({
            child: this._icon,
            style_class: 'panel-button better-tray-toggle-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: false,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.connect('notify::hover', () => this.updateState());
        this.actor.connect('scroll-event', (_actor, event) => this._onScroll(event));
        trackDisposal(this.actor);

        this._clickController = new ClickController(
            this.actor,
            this._settings,
            'toggle',
            action => this._executeAction(action),
            {propagateEvent: false}
        );
    }

    setOverflowMenu(overflowMenu) {
        this._overflowMenu = overflowMenu;
    }

    updateStyle() {
        const isCustomToggleStyleOn = this._settings.get_boolean('enable-custom-toggle-style');
        applyPanelClasses(this.actor, this._icon, isCustomToggleStyleOn);

        const style = computeToggleStyle(this._settings);
        this._baseStyle = style.baseStyle;
        this._hoverStyle = style.hoverStyle;
        this._iconColor = style.iconColor;
        this._iconHoverColor = style.iconHoverColor;

        this._icon.set_icon_size(this._settings.get_int('toggle-icon-size'));
        this._icon.set_style(this._iconColor ? `color: ${this._iconColor};` : '');
        this.actor.set_style(this._baseStyle);

        this.updateState();
    }

    updateState() {
        const isMenuOpen = this._overflowMenu.isOpen;
        const isHover = this.actor.hover;
        const isActive = isMenuOpen || isHover;

        this._applyIconState(isMenuOpen);

        if (!this._baseStyle) {
            if (isMenuOpen)
                this.actor.add_style_pseudo_class('active');
            else
                this.actor.remove_style_pseudo_class('active');
            return;
        }

        this.actor.set_style(isActive
            ? `${this._baseStyle} ${this._hoverStyle}`
            : this._baseStyle);
        this._icon.set_style(`color: ${isActive ? this._iconHoverColor : this._iconColor};`);
    }

    _applyIconState(isMenuOpen) {
        const rotate = this._settings.get_boolean('toggle-icon-rotate');
        const iconName = this._iconNameFor(isMenuOpen && !rotate
            ? 'toggle-icon-active-name'
            : 'toggle-icon-name');
        if (this._icon.icon_name !== iconName)
            this._icon.icon_name = iconName;

        const angle = isMenuOpen && rotate ? this._rotationAngle() : 0;
        // Hover fires while the turn is still running, comparing against the
        // live angle would restart it mid-flight.
        if (this._iconAngle === angle)
            return;

        this._iconAngle = angle;
        if (!this._settings.get_boolean('toggle-icon-rotate-animate')) {
            this._icon.rotation_angle_z = angle;
            return;
        }

        // The shell zeroes every animation while it renders without hardware
        // acceleration.
        this._icon.ease({
            rotation_angle_z: angle,
            duration: this._settings.get_int('toggle-icon-rotate-duration'),
            delay: this._settings.get_int('toggle-icon-rotate-delay'),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            animationRequired: true,
        });
    }

    _rotationAngle() {
        const degrees = Number.parseInt(this._settings.get_string('toggle-icon-rotate-angle'), 10);
        return this._settings.get_boolean('toggle-icon-rotate-reverse') ? -degrees : degrees;
    }

    _iconNameFor(key) {
        return this._settings.get_string(key) ||
            this._settings.get_default_value(key).unpack();
    }

    // Both menus share the toggle as source actor and the manager opens the
    // first match, so the order picks the hover menu. An open menu has to
    // come first too, otherwise hovering the toggle switches to its sibling.
    applyHoverMenuOrder() {
        if (!this._overflowMenu.isAttached)
            return;

        this._ensureActionMenu();

        const manager = Main.panel.menuManager;
        const isActionOpen = this._actionMenu.isOpen;
        const isOverflowOpen = this._overflowMenu.isOpen;

        // removeMenu on an open menu drops its modal grab, only the closed
        // one moves. Both open is the handover between them, the close that
        // follows sorts it out.
        if (isActionOpen && isOverflowOpen)
            return;

        if (isActionOpen) {
            this._overflowMenu.detachFromManager();
            this._overflowMenu.attachToManager();
            return;
        }

        if (isOverflowOpen) {
            manager.removeMenu(this._actionMenu);
            manager.addMenu(this._actionMenu);
            return;
        }

        const shouldActionGoFirst = this._settings.get_string('toggle-hover-menu') === HOVER_MENU_ACTION;

        manager.removeMenu(this._actionMenu);
        this._overflowMenu.detachFromManager();

        if (shouldActionGoFirst) {
            manager.addMenu(this._actionMenu);
            this._overflowMenu.attachToManager();
        } else {
            this._overflowMenu.attachToManager();
            manager.addMenu(this._actionMenu);
        }
    }

    // The popup and the action menu land here alike.
    onMenuOpenStateChanged(isOpen) {
        this.updateState();

        if (isOpen) {
            this.applyHoverMenuOrder();
            return;
        }

        // The manager's own handler runs after this one and pops the grab of
        // the menu that just closed, a removeMenu here would pop it first.
        debounceTo(this, '_hoverOrderId', 0, () => this.applyHoverMenuOrder());
    }

    // SMOOTH carries fractional deltas, rotating per delta would spin the
    // order.
    _onScroll(event) {
        if (this._settings.get_string('toggle-action-scroll') !== SCROLL_ACTION_CYCLE)
            return Clutter.EVENT_PROPAGATE;

        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            this._cycleIcons(true);
            break;
        case Clutter.ScrollDirection.DOWN:
            this._cycleIcons(false);
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_STOP;
    }

    _executeAction(action) {
        const handlers = {
            'toggle': () => this._overflowMenu.toggle(),
            'cycle': () => this._cycleIcons(),
            'action-menu': () => this._openActionMenu(),
            'prefs': () => this._openPreferences(),
        };
        handlers[action]?.();
    }

    _openActionMenu() {
        this._ensureActionMenu();
        this._actionMenuOverflowItem.setSensitive(this.actor.visible);

        this._actionMenu.toggle();
    }

    _ensureActionMenu() {
        if (this._actionMenu)
            return;

        this._actionMenu = createPanelMenu(this.actor);
        this._actionMenu.connect('open-state-changed',
            (_menu, isOpen) => this.onMenuOpenStateChanged(isOpen));

        Main.panel.menuManager.addMenu(this._actionMenu);

        this._actionMenuOverflowItem = new PopupMenu.PopupMenuItem(_('Open Overflow Menu'));
        this._actionMenuOverflowItem.connect('activate', () => {
            this._actionMenu.close();
            if (this.actor.visible)
                this._overflowMenu.open();
        });
        this._actionMenu.addMenuItem(this._actionMenuOverflowItem);

        const prefsItem = new PopupMenu.PopupMenuItem(_('Open Settings'));
        prefsItem.connect('activate', () => {
            this._actionMenu.close();
            this._openPreferences();
        });
        this._actionMenu.addMenuItem(prefsItem);
    }

    destroy() {
        clearIds(this, removeTimer, '_hoverOrderId');
        destroyMenuSafely(this._actionMenu);
        this._actionMenu = null;

        disposeAll(this, 'destroy', '_clickController');
        this._actionMenuOverflowItem = null;

        if (!isDisposed(this.actor))
            this.actor.destroy();
        this.actor = null;
        this._icon = null;
        this._overflowMenu = null;
    }
}
