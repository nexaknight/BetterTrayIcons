import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {BETTER_PANEL_UUID} from '../shared/api/ids.js';
import {clearSecondaryPanels, publishSecondaryPanels} from '../shared/appConfig.js';
import {clearIds, disconnectAll, disconnectSignal, removeTimer} from '../shared/lifecycle.js';

const PANEL_SURFACE = 'panel';

const BOX_NAMES = Object.freeze(['left', 'center', 'right']);

let _registry = null;

// Every panel a tray or a Quick Settings can stand in, Main.panel first.
// Dash to Panel and the BETTER_PANEL_UUID extension draw their own panels on
// other monitors.
export function enablePanelCopies() {
    _registry = new PanelCopies();
}

export function disablePanelCopies() {
    _registry?.destroy();
    _registry = null;
}

export function panelCopies() {
    return _registry?.copies ?? [];
}

export function isInAnyPanel(actor) {
    return panelCopies().some(copy => copy.contains(actor));
}

// An item in a popup belongs to the panel its popup opens from
export function panelCopyFor(actor) {
    const source = popupSourceOf(actor) ?? actor;
    return panelCopies().find(copy => copy.contains(source)) ?? null;
}

function popupSourceOf(actor) {
    for (let node = actor.get_parent(); node; node = node.get_parent()) {
        if (node._delegate instanceof PopupMenu.PopupMenu)
            return node._delegate.sourceActor;
    }
    return null;
}

export function connectPanelCopies(callback) {
    return _registry.connect('changed', callback);
}

export function disconnectPanelCopies(id) {
    _registry.disconnect(id);
}

export function mainPanelBoxes() {
    return {left: Main.panel._leftBox, center: Main.panel._centerBox, right: Main.panel._rightBox};
}

class PanelCopies extends EventEmitter {
    constructor() {
        super();
        this._copies = new Map([[Main.panel, shellCopy()]]);
        // Read on every pick and paint of a tray item, so it is built once per scan
        this._copyList = [...this._copies.values()];
        this._dashToPanel = null;
        this._panelsCreatedId = 0;
        this._chromeSignals = [];
        this._rescanId = 0;

        // Both peers may load before or after us, and a disable and enable of
        // Dash to Panel builds a new global.dashToPanel.
        this._stateChangedId = Main.extensionManager.connect(
            'extension-state-changed', () => this._rehook());
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._queueRescan());
        this._rehook();
    }

    get copies() {
        return this._copyList;
    }

    _rehook() {
        const emitter = global.dashToPanel ?? null;
        if (emitter !== this._dashToPanel) {
            disconnectSignal(this, this._dashToPanel, '_panelsCreatedId');
            this._dashToPanel = emitter;
            this._panelsCreatedId = emitter?.connect('panels-created', () => this._rescan()) ?? 0;
        }
        this._watchChrome(Main.extensionManager.lookup(BETTER_PANEL_UUID)?.state === ExtensionState.ACTIVE);
        this._rescan();
    }

    // The BETTER_PANEL_UUID extension builds and drops its bars without a
    // signal, a deferred enable included, and every bar goes through addChrome
    // into uiGroup.
    _watchChrome(isWanted) {
        const uiGroup = Main.layoutManager.uiGroup;
        if (!isWanted) {
            disconnectAll(this, uiGroup, '_chromeSignals');
            return;
        }
        if (this._chromeSignals.length)
            return;
        this._chromeSignals = ['child-added', 'child-removed']
            .map(signal => uiGroup.connect(signal, () => this._queueRescan()));
    }

    _queueRescan() {
        if (this._rescanId)
            return;
        this._rescanId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._rescanId = 0;
            this._rescan();
            return GLib.SOURCE_REMOVE;
        });
    }

    // A copy object lives as long as its panel, so consumers can key on it.
    _rescan() {
        const builders = [
            [Main.panel, shellCopy],
            ...dashToPanelPanels().map(panel => [panel, () => dashToPanelCopy(panel)]),
            ...betterPanelBars().map(bar => [bar, () => betterPanelCopy(bar)]),
        ];
        const next = new Map(builders.map(([key, build]) => [key, this._copies.get(key) ?? build()]));
        const isSame = next.size === this._copies.size && [...next.keys()].every(key => this._copies.has(key));
        this._copies = next;
        this._copyList = [...next.values()];
        if (isSame)
            return;
        const hasSeveralMonitors = new Set(this.copies.map(copy => copy.monitorIndex)).size > 1;
        publishSecondaryPanels(hasSeveralMonitors);
        this.emit('changed');
    }

    destroy() {
        clearIds(this, removeTimer, '_rescanId');
        disconnectSignal(this, Main.extensionManager, '_stateChangedId');
        disconnectSignal(this, Main.layoutManager, '_monitorsChangedId');
        disconnectSignal(this, this._dashToPanel, '_panelsCreatedId');
        disconnectAll(this, Main.layoutManager.uiGroup, '_chromeSignals');
        this.disconnectAll();
        this._dashToPanel = null;
        this._copies.clear();
        this._copyList = [];
        clearSecondaryPanels();
    }
}

// The primary Dash to Panel panel is Main.panel itself, only standalone ones
// are copies of their own.
function dashToPanelPanels() {
    return (global.dashToPanel?.panels ?? []).filter(panel => panel.isStandalone);
}

function betterPanelBars() {
    return Main.extensionManager.lookup(BETTER_PANEL_UUID)?.stateObj?._bars?._bars ?? [];
}

function shellCopy() {
    return {
        isPrimary: true,
        surface: PANEL_SURFACE,
        panel: Main.panel,
        get monitorIndex() {
            return mainPanelMonitor();
        },
        menuManager: Main.panel.menuManager,
        get quickSettings() {
            return Main.panel.statusArea.quickSettings ?? null;
        },
        boxes: mainPanelBoxes(),
        contains: actor => Main.panel.contains(actor),
    };
}

// Dash to Panel moves Main.panel into a box of its own on the monitor its
// settings pick, and panels-created fires before that box has a position, so
// the geometry would name the monitor at the origin.
function mainPanelMonitor() {
    const dtpPrimary = global.dashToPanel?.panels?.find(panel => !panel.isStandalone);
    return dtpPrimary?.monitor.index ?? Main.layoutManager.primaryIndex;
}

function dashToPanelCopy(dtpPanel) {
    return {
        isPrimary: false,
        surface: PANEL_SURFACE,
        panel: dtpPanel.panel,
        monitorIndex: dtpPanel.monitor.index,
        menuManager: dtpPanel.menuManager,
        // DtP pools a Quick Settings it takes off a panel, so read it live.
        get quickSettings() {
            return dtpPanel.statusArea.quickSettings ?? null;
        },
        boxes: {left: dtpPanel.panel._leftBox, center: dtpPanel.panel._centerBox, right: dtpPanel.panel._rightBox},
        contains: actor => dtpPanel.panel.contains(actor),
    };
}

// A bar's own applets use its extension's detached manager, which is out of
// reach, so each bar gets one of ours and its hover switch stays on that bar.
function betterPanelCopy(bar) {
    const boxes = Object.fromEntries(BOX_NAMES.map(name => [name, bar.box(name)]));
    return {
        isPrimary: false,
        surface: bar.family?.place ?? PANEL_SURFACE,
        // The bar paints in segments of its own, the area is the closest
        // single ancestor of what we put there.
        panel: boxes.right,
        monitorIndex: bar.monitorIndex,
        menuManager: new PopupMenu.PopupMenuManager(boxes.right),
        quickSettings: null,
        boxes,
        contains: actor => BOX_NAMES.some(name => bar.box(name)?.contains(actor)),
    };
}
