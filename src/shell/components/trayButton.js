import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {moveActorToIndex} from '../actorPlacement.js';

const TRAY_ROLE = 'bti-tray';

// Only what stands in Main.panel.statusArea can be found and moved by a peer
// like Better Panel, and addToStatusArea takes nothing but a PanelMenu.Button.
// PanelIndicator cannot be that button, PanelMenu's ButtonBox allocates only
// its first child and the tray needs its own box layout.
export const TrayButton = GObject.registerClass({GTypeName: 'BetterTrayIconsTrayButton'},
    class TrayButton extends PanelMenu.Button {
        _init(indicator) {
            super._init(0, _('Tray Icons'), true);

            // The base class leaves a dummy menu behind and the panel hands that
            // to its menu manager, whose hover switch would then open a tray
            // icon's menu the moment the pointer enters it.
            this.setMenu(null);

            // The panel-button class carries the pill, the hover fill and both
            // hpaddings, so the zeros get named here once it is gone.
            this.remove_style_class_name('panel-button');
            this.set_style('-minimum-hpadding: 0px; -natural-hpadding: 0px;');

            this.add_child(indicator);
        }
    });

// The shell refuses a second registration for the same role, so a later
// position change moves the container the way the panel's own _addToPanelBox
// does.
export function placeIndicatorInPanel(trayButton, settings) {
    const boxName = settings.get_string('tray-position');
    const order = settings.get_int('tray-order');

    if (Main.panel.statusArea[TRAY_ROLE] !== trayButton) {
        Main.panel.addToStatusArea(TRAY_ROLE, trayButton, order, boxName);
        return;
    }

    const boxes = {
        left: Main.panel._leftBox,
        center: Main.panel._centerBox,
        right: Main.panel._rightBox,
    };
    moveActorToIndex(trayButton.container, boxes[boxName] ?? Main.panel._rightBox, order);
}
