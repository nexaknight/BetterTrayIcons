import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isDisposed} from './disposal.js';

export function safeBounds(actor) {
    if (isDisposed(actor))
        return null;
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x, y, w, h];
}

// The allocation ignores a running slide, so this is where the actor will
// settle, not where it is drawn right now.
export function settledBounds(actor) {
    if (!actor.has_allocation())
        return null;
    const [px, py] = actor.get_parent().get_transformed_position();
    const box = actor.get_allocation_box();
    return [px + box.x1, py + box.y1, box.x2 - box.x1, box.y2 - box.y1];
}

export function stageScaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
}

export function moveActorToIndex(actor, parent, index) {
    if (isDisposed(actor) || isDisposed(parent))
        return;

    const current = actor.get_parent();
    if (current !== parent) {
        current?.remove_child(actor);
        parent.insert_child_at_index(actor, index);
        return;
    }

    if (parent.get_children().indexOf(actor) === index)
        return;
    parent.set_child_at_index(actor, index);
}

export function placeIndicatorInPanel(indicator, settings) {
    const currentParent = indicator.get_parent();
    if (currentParent)
        currentParent.remove_child(indicator);

    const boxes = {
        left: Main.panel._leftBox,
        center: Main.panel._centerBox,
        right: Main.panel._rightBox,
    };
    const targetBox = boxes[settings.get_string('tray-position')] ?? Main.panel._rightBox;

    targetBox.insert_child_at_index(indicator, settings.get_int('tray-order'));
}

export function connectSurfaceChanges(actor, run) {
    actor.connect('parent-set', () => {
        if (actor.get_parent())
            run();
    });
}
