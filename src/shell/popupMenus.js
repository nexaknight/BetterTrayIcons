import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isDisposed} from './disposal.js';

export const POPUP_ANIMATION_NONE = 0;

export function createPanelMenu(sourceActor, configure = null) {
    const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.TOP);
    menu.actor.add_style_class_name('panel-menu');
    configure?.(menu);
    Main.layoutManager.uiGroup.add_child(menu.actor);
    menu.actor.hide();
    return menu;
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
