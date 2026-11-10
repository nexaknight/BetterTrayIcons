import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

import {TRAY_STYLE_KEYS} from '../../const.js';
import {clearIds, debounceTo, disconnectAll, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {connectSurfaceChanges} from '../actorPlacement.js';
import {FOREIGN_ACTOR_PROP} from '../api/foreignItems.js';
import {isDisposed, trackDisposal, watchDisposal} from '../disposal.js';
import {ClickController, TRAY_ACTION_PREFIX} from '../features/clickController.js';
import {DRAG_SETTING_KEYS, forwardDragStateToIndicator, setupIconDragSource, syncDragEnabled} from '../features/dragAndDrop.js';
import {applyTitle, createTrayActor, syncTooltip} from '../features/tooltip.js';
import {connectPanelCopies, disconnectPanelCopies, panelCopies, panelCopyFor} from '../panelCopies.js';
import {restoreMenuGrabs} from '../popupMenus.js';
import {connectColorSetChanges, refreshTrayStyle, syncHoverStyle} from '../trayStyle.js';
import {PanelIndicator} from './panelIndicator.js';
import {placeIndicatorInPanel, TrayButton} from './trayButton.js';

const PLACEMENT_KEYS = Object.freeze(['tray-order', 'tray-position']);

// Long enough for the app to read its window's place and open its menu there
const EMBED_RETURN_MS = 500;

// The primary's tray once more on every other monitor's panel. Each mirror is
// a PanelIndicator of its own, so it follows the same settings, and its items
// paint the primary's through a Clutter.Clone and hand every click back.
export class TrayMirrors {
    constructor(settings, trayButton, primary, openPreferences) {
        this._settings = settings;
        this._trayButton = trayButton;
        this._primary = primary;
        this._openPreferences = openPreferences;
        this._mirrors = new Map();

        this._settingsSignals = [
            settings.connect('changed::show-on-all-monitors', () => this._sync()),
            ...PLACEMENT_KEYS.map(key => settings.connect(`changed::${key}`,
                () => this._mirrors.forEach(mirror => mirror.place()))),
        ];
        this._copiesChangedId = connectPanelCopies(() => this._sync());
        // A wrapper only learns of an item through the primary's layout pass
        this._layoutChangedId = primary.connect('layout-changed',
            () => this._mirrors.forEach(mirror => mirror.syncItems()));
        // The BETTER_PANEL_UUID extension can move the primary to a bar on
        // another monitor
        this._parentSetId = trayButton.container.connect('parent-set', () => this._sync());
        this._sync();
    }

    _sync() {
        const isWanted = this._settings.get_boolean('show-on-all-monitors');
        const targets = isWanted ? mirrorTargets(panelCopyFor(this._trayButton)) : [];
        for (const [copy, mirror] of [...this._mirrors]) {
            if (!targets.includes(copy))
                mirror.destroy();
        }
        for (const copy of targets) {
            if (this._mirrors.has(copy))
                continue;
            this._mirrors.set(copy, new TrayMirror({
                settings: this._settings,
                primary: this._primary,
                copy,
                openPreferences: this._openPreferences,
                onGone: () => this._mirrors.delete(copy),
            }));
        }
    }

    destroy() {
        disconnectAll(this, this._settings, '_settingsSignals');
        clearIds(this, disconnectPanelCopies, '_copiesChangedId');
        clearIds(this, id => this._primary.disconnect(id), '_layoutChangedId');
        clearIds(this, id => this._trayButton.container.disconnect(id), '_parentSetId');
        [...this._mirrors.values()].forEach(mirror => mirror.destroy());
    }
}

// One per monitor that has no tray yet, on the same kind of bar the primary
// stands in where a monitor carries both a panel and a dock.
function mirrorTargets(holder) {
    if (!holder)
        return [];
    const byMonitor = new Map();
    for (const copy of panelCopies()) {
        if (copy.monitorIndex === holder.monitorIndex)
            continue;
        const kept = byMonitor.get(copy.monitorIndex);
        const isBetterMatch = kept && kept.surface !== holder.surface && copy.surface === holder.surface;
        if (!kept || isBetterMatch)
            byMonitor.set(copy.monitorIndex, copy);
    }
    return [...byMonitor.values()];
}

class TrayMirror {
    constructor({settings, primary, copy, openPreferences, onGone}) {
        this._settings = settings;
        this._primary = primary;
        this._copy = copy;
        this._onGone = onGone;
        this._items = new Map();
        this._lentEmbed = null;
        this._embedReturnId = 0;

        this._indicator = new PanelIndicator(settings, openPreferences, copy.panel);
        this._button = trackDisposal(new TrayButton(this._indicator));
        this._button.connect('destroy', () => this._release());
        // Dash to Panel takes a panel down with its monitor. The panel's destroy
        // comes before its children's, so the grabs are back before the popup closes.
        this._panelGoneId = watchDisposal(copy.panel, () => this.destroy());

        this._settingsSignalId = settings.connect('changed', (_settings, key) => {
            if (TRAY_STYLE_KEYS.includes(key))
                this._restyle();
            else if (DRAG_SETTING_KEYS.includes(key))
                this._items.forEach(item => syncDragEnabled(item.draggable, settings));
        });
        this._colorSetWatch = connectColorSetChanges(settings, () => this._restyle());

        this.place();
        this.syncItems();
    }

    place() {
        placeIndicatorInPanel(this._button, this._settings, this._copy);
    }

    syncItems() {
        const sources = new Map(this._primary.iconEntries()
            .filter(([, actor]) => !actor[FOREIGN_ACTOR_PROP] && !isDisposed(actor)));
        for (const id of [...this._items.keys()]) {
            if (sources.get(id) !== this._items.get(id).source)
                this._dropItem(id);
        }
        for (const [id, source] of sources) {
            if (!this._items.has(id))
                this._addItem(id, source);
        }
        this._indicator.queueUpdateLayout();
    }

    // The layout reads hidden, Passive and Wine state off the item, so the
    // wrapper answers with the source's
    _addItem(id, source) {
        const settings = this._settings;
        const {actor: wrapper, tooltip} = createTrayActor(settings);
        wrapper.set_child(new Clutter.Clone({source: source.get_child()}));
        Object.defineProperties(wrapper, {
            _appId: {get: () => source._appId},
            _isXembed: {get: () => source._isXembed},
            _isPassive: {get: () => source._isPassive},
        });
        wrapper._trayClickOwner = this._indicator;
        wrapper._trayGrabManagers = () => [this._copy.menuManager];

        const forward = (action, event) => {
            if (!isDisposed(source))
                source._trayAction(action, event, wrapper);
        };
        const item = {source, wrapper, tooltip, clickController: null};
        if (source._isXembed) {
            // The embedded window takes the raw click, as on the primary
            wrapper.connect('button-release-event', (_actor, event) => {
                this._lendEmbed(source, wrapper);
                forward(event.get_button() === Clutter.BUTTON_SECONDARY ? 'menu' : 'activate', event);
                return Clutter.EVENT_PROPAGATE;
            });
        } else {
            item.clickController = new ClickController(wrapper, settings, TRAY_ACTION_PREFIX,
                action => forward(action, null), {propagateEvent: true});
        }
        item.draggable = setupIconDragSource({
            actor: wrapper,
            appId: source._appId,
            settings,
            tooltip,
            onForwardedDragStateChange: forwardDragStateToIndicator(this._indicator),
        });
        if (item.clickController)
            item.draggable.setClickController(item.clickController);

        wrapper.connect('notify::hover', () => {
            syncHoverStyle(wrapper);
            applyTitle(wrapper, tooltip, settings, source._trayTitle);
            syncTooltip(wrapper, tooltip, settings);
        });
        wrapper.connect('scroll-event', (_actor, event) => source.emit('scroll-event', event));
        connectSurfaceChanges(wrapper, () => refreshTrayStyle(wrapper, null, settings));
        refreshTrayStyle(wrapper, null, settings);

        item.disposeId = watchDisposal(source, () => this._dropItem(id));
        this._items.set(id, item);
        this._indicator.addIcon(id, wrapper);
    }

    _dropItem(id) {
        const item = this._items.get(id);
        this._items.delete(id);
        if (!isDisposed(item.source))
            item.source.disconnect(item.disposeId);
        this._indicator.removeIcon(id);
        disposeAll(item, 'destroy', 'draggable', 'clickController', 'tooltip');
        if (!isDisposed(item.wrapper))
            item.wrapper.destroy();
    }

    // Wine and GTK open their menu at the hidden embedded window, which follows
    // the real icon's allocation (shell-tray-icon.c shell_tray_icon_allocate),
    // so it moves under the mirror for the click and back after.
    _lendEmbed(source, wrapper) {
        this._returnEmbed();
        const embed = source.get_child()?.get_first_child();
        if (!(embed instanceof Shell.TrayIcon) || !embed.has_allocation())
            return;
        const [x, y] = embed.get_transformed_position();
        const [toX, toY] = wrapper.get_transformed_position();
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return;

        this._lentEmbed = {source, embed, opacity: embed.opacity};
        // Hidden meanwhile, it would paint here and shifted inside our clone
        embed.opacity = 0;
        embed.set_translation(
            toX + (wrapper.width - embed.width) / 2 - x,
            toY + (wrapper.height - embed.height) / 2 - y, 0);
        reallocate(embed);
        debounceTo(this, '_embedReturnId', EMBED_RETURN_MS, () => this._returnEmbed());
    }

    _returnEmbed() {
        clearIds(this, removeTimer, '_embedReturnId');
        const lent = this._lentEmbed;
        this._lentEmbed = null;
        if (!lent || isDisposed(lent.source))
            return;
        lent.embed.set_translation(0, 0, 0);
        lent.embed.opacity = lent.opacity;
        reallocate(lent.embed);
    }

    _restyle() {
        this._items.forEach(({wrapper}) => refreshTrayStyle(wrapper, null, this._settings));
    }

    // Runs once whoever takes the button down, us or the panel around it
    _release() {
        if (!isDisposed(this._copy.panel))
            this._copy.panel.disconnect(this._panelGoneId);
        this._returnEmbed();
        clearIds(this, id => this._settings.disconnect(id), '_settingsSignalId');
        disposeAll(this, 'disconnect', '_colorSetWatch');
        [...this._items.keys()].forEach(id => this._dropItem(id));
        this._onGone();
    }

    // A click can hold the grabs of the open popup released, and the popup
    // closing on the way down pops that grab again
    destroy() {
        restoreMenuGrabs();
        if (!isDisposed(this._button))
            this._button.destroy();
    }
}

// Clutter skips an allocation whose box did not change, and the embed only
// moves its window from inside one
function reallocate(actor) {
    actor.queue_relayout();
    actor.allocate(actor.get_allocation_box());
}
