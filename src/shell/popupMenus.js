import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isDisposed} from './disposal.js';
import {shellUsesLightStyle} from './trayStyle.js';
import {THEME_FOREGROUND} from '../shared/colorContrast.js';
import {disconnectSignal} from '../shared/lifecycle.js';

// Opening upwards, the theme's bottom margin and the arrow rise leave a
// visible hole over the bar.
const RAISED_MENU_GAP_PX = 8;
const RAISED_MENU_CSS =
    `-arrow-rise: 0px; -boxpointer-gap: ${RAISED_MENU_GAP_PX}px; margin-bottom: 0px;`;

const LIGHT_MENU_CSS = `background-color: #ffffff; color: ${THEME_FOREGROUND.onLight};`;

// Menus on 51 take an options object, 49 and 50 a BoxPointer flag, and
// PopupMenuBase only grew open and close on 51.
const MENU_TAKES_PARAMS = PopupMenu.PopupMenuBase.prototype.open !== undefined;

export function menuAnimation(animate) {
    if (MENU_TAKES_PARAMS)
        return {animate};
    return animate ? BoxPointer.PopupAnimation.FULL : BoxPointer.PopupAnimation.NONE;
}

export const POPUP_ANIMATION_NONE = menuAnimation(false);
export const POPUP_ANIMATION_FULL = menuAnimation(true);

export function createPanelMenu(sourceActor, {configure = null, ownSurface = false, parent = Main.layoutManager.uiGroup} = {}) {
    const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.TOP);
    menu.actor.add_style_class_name('panel-menu');
    configure?.(menu);

    const baseStyle = menu.actor.get_style() ?? '';
    menu.connect('open-state-changed', (_menu, isOpen) => {
        if (!isOpen)
            return;
        menu.actor.set_style(menuOpensUpwards(sourceActor)
            ? `${baseStyle} ${RAISED_MENU_CSS}`
            : baseStyle);
        if (!ownSurface)
            applyMenuBoxStyle(menu);
    });

    parent.add_child(menu.actor);
    menu.actor.hide();
    return menu;
}

export function menuForegroundColor() {
    return shellUsesLightStyle() ? THEME_FOREGROUND.onLight : THEME_FOREGROUND.onDark;
}

// The surface color and a pinned width share the box style, and whoever
// writes it alone drops the other one.
export function applyMenuBoxStyle(menu, pinnedWidthCss = null) {
    if (pinnedWidthCss !== null)
        menu._pinnedWidthCss = pinnedWidthCss;

    const surface = shellUsesLightStyle() ? LIGHT_MENU_CSS : '';
    const css = [surface, menu._pinnedWidthCss].filter(Boolean).join(' ');
    menu.box.set_style(css || null);
}

// Not "is it in the panel", an extension can move Main.panel itself to the
// bottom edge.
function menuOpensUpwards(sourceActor) {
    const [x, y, width, height] = sourceRect(sourceActor);
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const monitor = Main.layoutManager.monitors.find(m =>
        centerX >= m.x && centerX < m.x + m.width &&
        centerY >= m.y && centerY < m.y + m.height);

    return monitor ? centerY > monitor.y + monitor.height / 2 : false;
}

// The dummy cursor was moved this very frame, so its transform still points at
// the previous menu. Its parent never moves, so parent position plus x/y holds.
function sourceRect(sourceActor) {
    const cursor = Main.layoutManager.dummyCursor;
    if (sourceActor === cursor) {
        const [parentX, parentY] = cursor.get_parent().get_transformed_position();
        return [parentX + cursor.x, parentY + cursor.y, cursor.width, cursor.height];
    }

    const extents = sourceActor.get_transformed_extents();
    const topLeft = extents.get_top_left();
    const bottomRight = extents.get_bottom_right();
    return [
        topLeft.x, topLeft.y,
        bottomRight.x - topLeft.x, bottomRight.y - topLeft.y,
    ];
}

// Popup icons anchor to the dummy cursor, an intellihide panel otherwise
// slides away mid-menu and takes the menu with it.
export function menuAnchorFor(actor) {
    if (Main.panel.contains(actor))
        return actor;

    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    Main.layoutManager.setDummyCursorGeometry(x, y, w, h);
    return Main.layoutManager.dummyCursor;
}

let _detachedMenuManager = null;

// The panel manager closes its open menu when another opens, which would shut
// the popup under a context menu opened from inside it.
export function menuManagerFor(actor, settings) {
    if (settings.get_boolean('keep-popup-after-click') && !Main.panel.contains(actor)) {
        _detachedMenuManager ??= new PopupMenu.PopupMenuManager(Main.panel);
        return _detachedMenuManager;
    }
    return Main.panel.menuManager;
}

export function clearDetachedMenuManager() {
    _detachedMenuManager = null;
}

export function destroyMenuSafely(menu) {
    if (!menu || isDisposed(menu.actor))
        return;

    // Without closing first, removeMenu leaves the manager pointing at this
    // menu and the next close pops a grab that is already gone.
    if (menu.isOpen)
        menu.close(POPUP_ANIMATION_NONE);

    Main.panel.menuManager.removeMenu(menu);

    // On 51 destroy leaves the menu's key controller on the source actor, and
    // our popup icons all share one dummy cursor.
    if (menu._keyController)
        menu.sourceActor?.remove_action(menu._keyController);

    menu.destroy();
}

const _flyoutMenus = [];
let _flyoutGrabState = null;

export function clearFlyoutMenus() {
    for (const menu of [..._flyoutMenus].reverse())
        menu._releaseGrab();
    _flyoutMenus.length = 0;
    _flyoutGrabState = null;
}

export class FlyoutMenu extends PopupMenu.PopupMenu {
    constructor(item) {
        super(item, 0, St.Side.LEFT);
        this._grab = null;
        this._capturedEventId = 0;
        Main.layoutManager.uiGroup.add_child(this.actor);
        this.actor.hide();
        this.connect('open-state-changed', (menu, isOpen) => {
            if (!isOpen) {
                this._releaseGrab();
                return;
            }
            applyMenuBoxStyle(this);
            this._takeGrab();
        });
    }

    get ownerMenu() {
        return this.sourceActor._getTopMenu();
    }

    _takeGrab() {
        const layer = Main.layoutManager.uiGroup;
        if (_flyoutMenus.length === 0) {
            _flyoutGrabState = {
                reactive: layer.reactive,
                sourceActor: layer._sourceActor,
            };
        }
        _flyoutMenus.push(this);
        // Clutter only delivers to reactive actors, the grab alone sees nothing
        layer.reactive = true;
        this._grab = Main.pushModal(layer, {actionMode: Shell.ActionMode.POPUP});
        // An auto hiding panel checks the grab's _sourceActor before it hides
        layer._sourceActor = menuChainFrom(this).at(-1).sourceActor;
        this.actor.grab_key_focus();
        this._capturedEventId = layer.connect('captured-event',
            (actor, event) => this._onCapturedEvent(event));
    }

    _releaseGrab() {
        if (!this._grab)
            return;
        const layer = Main.layoutManager.uiGroup;
        disconnectSignal(this, layer, '_capturedEventId');
        Main.popModal(this._grab);
        this._grab = null;

        _flyoutMenus.splice(_flyoutMenus.indexOf(this), 1);
        if (_flyoutMenus.length > 0) {
            layer._sourceActor = menuChainFrom(_flyoutMenus.at(-1)).at(-1).sourceActor;
        } else {
            layer.reactive = _flyoutGrabState.reactive;
            if (_flyoutGrabState.sourceActor === undefined)
                delete layer._sourceActor;
            else
                layer._sourceActor = _flyoutGrabState.sourceActor;
            _flyoutGrabState = null;
        }
    }

    _onCapturedEvent(event) {
        // Nested flyouts share the capture actor; only the top grab handles input.
        if (_flyoutMenus.at(-1) !== this)
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS &&
            this._handleFlyoutKey(event) === Clutter.EVENT_STOP)
            return Clutter.EVENT_STOP;

        const target = global.stage.get_event_actor(event);
        const chain = menuChainFrom(this);
        const isPress = type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.TOUCH_BEGIN;
        if (!isPress) {
            return chain.some(menu => menu.actor.contains(target))
                ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
        }

        // Every link but the last hangs off a menu item. A press on that item
        // runs its own toggle, closing here would let the release reopen it.
        const toggled = chain.slice(0, -1).find(menu => menu.sourceActor.contains(target));
        const pressed = toggled || chain.find(menu => menu.actor.contains(target));
        for (const menu of chain) {
            if (menu === pressed)
                break;
            menu.close(POPUP_ANIMATION_FULL);
        }
        // The click that closes everything must not also hit what is behind
        return pressed ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
    }

    _handleFlyoutKey(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this.close(POPUP_ANIMATION_FULL);
            return Clutter.EVENT_STOP;
        }

        const isMenuFocused = global.stage.get_key_focus() === this.actor;
        if (symbol === Clutter.KEY_Down && isMenuFocused) {
            this.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        this._releaseGrab();
        super.destroy();
    }
}

function menuChainFrom(menu) {
    const chain = [menu];
    let current = menu;
    while (current.sourceActor instanceof PopupMenu.PopupBaseMenuItem) {
        current = current.sourceActor._getTopMenu();
        chain.push(current);
    }
    return chain;
}

export function closeMenuChain(menu) {
    for (const link of menuChainFrom(menu))
        link.close(POPUP_ANIMATION_NONE);
}

// A menu taller than its side of the icon makes the box pointer flip
// sides, a menu over the bar then lands below it.
export function submenuFitsInline(submenu) {
    const topMenu = submenu._getTopMenu();
    const [, menuHeight] = topMenu.actor.get_preferred_height(-1);
    const [, submenuHeight] = submenu.actor.get_preferred_height(-1);
    return menuHeight + submenuHeight <= inlineRoom(topMenu);
}

// Above or below the icon the menu can only grow away from it. Next to
// it the box pointer just slides it along the work area.
function inlineRoom(topMenu) {
    const menu = topMenu.actor;
    const [, sourceTop] = topMenu.sourceActor.get_transformed_position();
    const [, sourceHeight] = topMenu.sourceActor.get_transformed_size();
    const workArea = Main.layoutManager.getWorkAreaForMonitor(
        Main.layoutManager.findIndexForActor(menu));
    const margins = menu.margin_top + menu.margin_bottom;

    if (menu.y + menu.height <= sourceTop)
        return menu.y + menu.height - workArea.y - margins;
    if (menu.y >= sourceTop + sourceHeight)
        return workArea.y + workArea.height - menu.y - margins;
    return workArea.height - margins;
}
