import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isDisposed} from './disposal.js';

// Opening upwards, the theme's bottom margin and the arrow rise leave a
// visible hole over the bar. Both get zeroed, -boxpointer-gap sets the
// real distance instead.
const RAISED_MENU_GAP_PX = 8;
const RAISED_MENU_CSS =
    `-arrow-rise: 0px; -boxpointer-gap: ${RAISED_MENU_GAP_PX}px; margin-bottom: 0px;`;

export const POPUP_ANIMATION_NONE = 0;

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

    Main.layoutManager.uiGroup.add_child(menu.actor);
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
