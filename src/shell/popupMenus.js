import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isDisposed} from './disposal.js';
import {disconnectSignal} from '../shared/lifecycle.js';

// Opening upwards, the theme's bottom margin and the arrow rise leave a
// visible hole over the bar. Both get zeroed, -boxpointer-gap sets the
// real distance instead.
const RAISED_MENU_GAP_PX = 8;
const RAISED_MENU_CSS =
    `-arrow-rise: 0px; -boxpointer-gap: ${RAISED_MENU_GAP_PX}px; margin-bottom: 0px;`;

export const POPUP_ANIMATION_NONE = 0;

let _menuLayer = null;

// A flyout's grab has to cover the menu it came from, or that menu goes
// dead under it.
function menuLayer() {
    if (!_menuLayer) {
        _menuLayer = new Clutter.Actor();
        Main.layoutManager.uiGroup.add_child(_menuLayer);
    }
    return _menuLayer;
}

export function clearMenuLayer() {
    _menuLayer?.destroy();
    _menuLayer = null;
}

export function createPanelMenu(sourceActor, configure = null) {
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
    });

    menuLayer().add_child(menu.actor);
    menu.actor.hide();
    return menu;
}

// Not "is it in the panel", Simple Taskbar moves Main.panel itself to the
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

// Popup icons anchor to the dummy cursor, an intellihide panel (Dash to
// Panel) otherwise slides away mid-menu and takes the menu with it.
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
    menu.destroy();
}

// For a submenu the menu has no room to unfold. The shell's menu manager
// would close the menu underneath, so the flyout grabs the shared layer
// instead.
export class FlyoutMenu extends PopupMenu.PopupMenu {
    constructor(item) {
        super(item, 0, St.Side.LEFT);
        this._grab = null;
        this._capturedEventId = 0;
        menuLayer().add_child(this.actor);
        this.actor.hide();
        this.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen)
                this._takeGrab();
            else
                this._releaseGrab();
        });
    }

    get ownerMenu() {
        return this.sourceActor._getTopMenu();
    }

    _takeGrab() {
        const layer = menuLayer();
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
        const layer = menuLayer();
        disconnectSignal(this, layer, '_capturedEventId');
        layer._sourceActor = null;
        layer.reactive = false;
        Main.popModal(this._grab);
        this._grab = null;
    }

    _onCapturedEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS)
            return this._onKeyPress(event);

        const isPress = type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.TOUCH_BEGIN;
        if (!isPress)
            return Clutter.EVENT_PROPAGATE;

        const target = global.stage.get_event_actor(event);
        const chain = menuChainFrom(this);
        const pressed = chain.find(menu => menu.actor.contains(target));
        for (const menu of chain) {
            if (menu === pressed)
                break;
            menu.close(BoxPointer.PopupAnimation.FULL);
        }
        // The click that closes everything must not also hit what is behind
        return pressed ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this.close(BoxPointer.PopupAnimation.FULL);
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

export function menuChainFrom(menu) {
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
        link.close();
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
