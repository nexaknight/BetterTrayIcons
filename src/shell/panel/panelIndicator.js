import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {getAppConfigMap, setAppPriorities, byPriorityThenAppId, publishVisibleOrder, clearVisibleOrder} from '../../shared/appConfig.js';
import {clearIds, debounceTo, disconnectAll, disconnectSignal, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {connectColorSetChanges, isDisposed, moveActorToIndex, trackDisposal} from '../utils/actor.js';
import {
    getDraggableFromSource,
    isPointInActor,
    slotIndexAt,
    dragStageCoords,
} from './dropTarget.js';
import {OverflowMenu} from './overflowMenu.js';
import {ToggleButton} from './toggleButton.js';

const LAYOUT_UPDATE_DELAY_MS = 100;
const MENU_REGRAB_DELAY_MS = 0;
const GEOMETRY_SETTLE_MS = 50;
const DRAG_MOVE_DWELL_MS = 100;

// Without a travel floor, tremor on a cell edge restarts the dwell forever
const DRAG_RETARGET_TRAVEL_PX = 16;

const DRAG_SLIDE_MS = 200;
const DRAG_SLIDE_STAGGER_MS = 10;

export const PanelIndicator = GObject.registerClass({GTypeName: 'BetterTrayIconsPanelIndicator'},
    class PanelIndicator extends St.BoxLayout {
        _init(settings, openPreferences) {
            super._init({
                style_class: 'better-tray-indicator-container',
                reactive: true,
                track_hover: false,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.FILL,
                style: 'margin: 0; padding: 0; spacing: 0;',
            });

            this._destroyHandlerId = this.connect('destroy', () => this._teardown());

            this._settings = settings;
            this._icons = new Map();
            this._onIconsChanged = null;

            this._layoutUpdateId = 0;
            this._settleTimeoutId = 0;
            this._menuRegrabId = 0;
            this._reopenPopupId = 0;
            this._hoverOrderId = 0;
            this._overflowMenu = null;

            this._menuRemovedForDrag = false;
            this._dragGrabActor = null;
            this._dragActive = false;
            this._layoutAfterDrag = false;
            this._dragOrder = null;
            this._dropAccepted = false;
            this._dwellId = 0;
            this._pendingOrder = null;
            this._pendingAnchor = null;
            this._slideWatches = new Map();

            this._visibleBox = new St.BoxLayout({
                style_class: 'tray-visible-box',
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: false,
                y_expand: true,
                reactive: false,
                style: 'spacing: 0px; padding: 0px; margin: 0px;',
            });
            this.add_child(this._visibleBox);

            this._toggleButton = new ToggleButton(this._settings, {
                openPreferences,
                cycleIcons: reverse => this._cycleIcons(reverse),
            });
            this.add_child(this._toggleButton.actor);
            trackDisposal(this);
            trackDisposal(this._visibleBox);

            this._overflowMenu = new OverflowMenu(this._settings, this._toggleButton.actor, isOpen => {
                this._toggleButton.updateState();

                if (!isOpen)
                    debounceTo(this, '_hoverOrderId', 0, () => this._toggleButton.applyHoverMenuOrder());
            });
            this._overflowMenu.container._delegate = this;
            this._toggleButton.setOverflowMenu(this._overflowMenu);

            const queueLayout = () => this._queueUpdateLayout();

            this._settingsSignals = [];
            const LAYOUT_KEYS = [
                'overflow-layout-mode',
                'grid-column-limit',
                'visible-icon-limit',
                'toggle-position',
                'enable-wine-support',
            ];
            for (const key of LAYOUT_KEYS)
                this._settingsSignals.push(this._settings.connect(`changed::${key}`, queueLayout));

            this._lastLayoutSignature = '';
            this._settingsSignals.push(this._settings.connect('changed::app-configs', () => {
                if (this._computeLayoutSignature() !== this._lastLayoutSignature)
                    this._queueUpdateLayout();
            }));

            this._settingsSignals.push(this._settings.connect('changed::toggle-hover-menu',
                () => this._toggleButton.applyHoverMenuOrder()));

            // Inherit mode reads any icon-* key, so match by prefix.
            const STYLE_KEY_PREFIXES = ['toggle-', 'overflow-container-', 'icon-', 'enable-custom-'];
            this._settingsSignals.push(this._settings.connect('changed', (_settings, key) => {
                if (STYLE_KEY_PREFIXES.some(prefix => key.startsWith(prefix)))
                    this._updateStyle();
            }));

            this._colorSetWatch = connectColorSetChanges(this._settings, () => this._updateStyle());

            this._enableCustomStyle = false;

            this._updateStyle();
            this._queueUpdateLayout();

            this._delegate = this;
        }

        addIcon(id, actor) {
            if (this._icons.has(id))
                return;
            this._icons.set(id, actor);
            this._queueUpdateLayout();
        }

        removeIcon(id) {
            if (!this._icons.has(id))
                return;
            this._icons.delete(id);
            this._queueUpdateLayout();
            this._onIconsChanged?.(id);
        }

        setIconsChangedHandler(callback) {
            this._onIconsChanged = callback;
        }

        // The icon already fired its action, this only settles the popup.
        _handleIconClick() {
            if (this._settings.get_boolean('keep-popup-after-click')) {
                // The SNI action may shift focus, e.g. raise a window, which
                // drops Shell's modal grab and closes the popup.
                clearIds(this, removeTimer, '_reopenPopupId');

                this._reopenPopupId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._reopenPopupId = 0;
                    if (!this._overflowMenu.isOpen &&
                        this._settings.get_boolean('keep-popup-after-click'))
                        this._overflowMenu.open();

                    return GLib.SOURCE_REMOVE;
                });
            } else if (this._overflowMenu.isOpen) {
                this._overflowMenu.close();
            }
        }

        // Reordering invisible icons would write the blob for nothing.
        _cycleIcons(reverse = false) {
            const allItems = this._collectIconEntries(true);
            if (allItems.length < 2)
                return;

            if (reverse)
                allItems.unshift(allItems.pop());
            else
                allItems.push(allItems.shift());

            setAppPriorities(this._settings, allItems.map(item => item.appId));
        }

        _collectIconEntries(visibleOnly = false) {
            return this._liveIconEntries().filter(item =>
                !item.config?.is_hidden &&
                (!visibleOnly || (item.actor.visible && item.actor.get_parent())));
        }

        _liveIconEntries() {
            const configMap = getAppConfigMap(this._settings);

            const items = [];
            for (const [id, actor] of this._icons) {
                if (!actor || !actor.get_parent || isDisposed(actor)) {
                    this._icons.delete(id);
                    continue;
                }
                const appId = actor._appId;
                const config = (appId && configMap[appId]) || null;
                items.push({appId, actor, config, priority: config?.priority || 0});
            }
            items.sort(byPriorityThenAppId);
            return items;
        }

        _queueUpdateLayout() {
            debounceTo(this, '_layoutUpdateId', LAYOUT_UPDATE_DELAY_MS, () => this._updateLayout());
        }

        _updateLayout() {
            const toggleActor = this._toggleButton.actor;
            // The pending timer can still fire after C-side disposal of
            // children even when JS refs look non-null.
            if (isDisposed(this) || isDisposed(this._visibleBox) ||
                isDisposed(toggleActor))
                return;
            // The drag actor must stay where DND parked it, rerun after
            // the drop.
            if (this._dragActive) {
                this._layoutAfterDrag = true;
                return;
            }

            const togglePos = this._settings.get_string('toggle-position');
            const wineEnabled = this._settings.get_boolean('enable-wine-support');

            const sortedActors = [];
            for (const {actor, config} of this._liveIconEntries()) {
                // Wine-off wrappers and Passive items stay registered, the
                // layout must not resurrect them.
                const isHidden = config?.is_hidden ||
                    (actor._isXembed && !wineEnabled) ||
                    actor._isPassive;

                actor.visible = !isHidden;
                if (!isHidden)
                    sortedActors.push(actor);
            }

            const visibleCount = this._visibleCountFor(sortedActors.length);
            const overflowCount = sortedActors.length - visibleCount;
            const hasOverflow = overflowCount > 0;

            if (hasOverflow) {
                this._overflowMenu.attachToManager();
                toggleActor.show();
                this._toggleButton.applyHoverMenuOrder();
            } else {
                this._overflowMenu.close();
                this._overflowMenu.detachFromManager();
                toggleActor.hide();
            }

            this._placeIntoContainers(sortedActors);

            this._overflowMenu.updateGeometry(overflowCount);

            debounceTo(this, '_settleTimeoutId', GEOMETRY_SETTLE_MS, () => this._overflowMenu.updateGeometry());

            // A remove plus add would unmap the toggle for a moment, and the
            // popup closes as soon as its source actor, the toggle, unmaps.
            const order = hasOverflow && togglePos === 'left'
                ? [toggleActor, this._visibleBox]
                : [this._visibleBox, toggleActor];
            order.forEach((child, index) => moveActorToIndex(child, this, index));

            this._lastLayoutSignature = this._computeLayoutSignature();

            const seen = new Set();
            const ids = [];
            for (const {appId} of this._iconsInVisualOrder()) {
                if (appId && !seen.has(appId)) {
                    seen.add(appId);
                    ids.push(appId);
                }
            }
            publishVisibleOrder(ids);
        }

        _computeLayoutSignature() {
            const configMap = getAppConfigMap(this._settings);

            const parts = [];
            for (const [id, actor] of this._icons) {
                // Keyed by the item because two items can share an appId.
                const appId = actor._appId;
                const c = appId && configMap[appId];
                parts.push(`${id}:${c?.is_hidden ? 1 : 0}:${c?.priority ?? 0}`);
            }
            parts.sort();
            return parts.join('|');
        }

        _updateStyle() {
            this._toggleButton.updateStyle();

            this._enableCustomStyle = this._settings.get_boolean('enable-custom-overflow-style');
            this._overflowMenu.applyStyle(this._enableCustomStyle);
            // applyStyle measures the children before a shrink has relaid
            // them out, so the old width wins the max. Measure again settled.
            debounceTo(this, '_settleTimeoutId', GEOMETRY_SETTLE_MS, () => this._overflowMenu.updateGeometry());
        }

        // Close before detaching, removeMenu on an open menu only drops the
        // grab and the next emit would pop a modal that is already gone. The
        // reopen then runs without a manager grab, so DND keeps its own.
        _onAnyDragBegin() {
            this._dragActive = true;
            this._dropAccepted = false;
            // The whole arrangement, the neighbours move between the
            // containers too and a cancel writes nothing that would restore them.
            this._dragOrder = this._iconsInVisualOrder().map(entry => entry.actor);
            this._claimDragGrab();

            if (!this._toggleButton.actor.visible)
                return;

            if (Main.panel.menuManager && !this._menuRemovedForDrag) {
                if (this._overflowMenu.isOpen) {
                    try {
                        this._overflowMenu.close();
                    } catch { /* menu already closed */ }
                }
                this._menuRemovedForDrag = true;
                try {
                    this._overflowMenu.detachFromManager();
                } catch { /* not in manager */ }
            }

            if (!this._overflowMenu.isOpen) {
                try {
                    this._overflowMenu.open();
                } catch { /* menu disposed mid-drag */ }
            }
        }

        // DND grabs a bare actor in uiGroup, auto-hiding panels like Dash
        // to Panel see no grab of their own and hide mid-drag. _sourceActor
        // links the grab back to us in the panel.
        _claimDragGrab() {
            const grabActor = global.stage.get_grab_actor();
            if (!grabActor || grabActor._sourceActor)
                return;
            grabActor._sourceActor = this;
            this._dragGrabActor = grabActor;
        }

        // The grab actor is shared by every drag, the tag must come off.
        _releaseDragGrab() {
            if (!this._dragGrabActor)
                return;
            if (this._dragGrabActor._sourceActor === this)
                this._dragGrabActor._sourceActor = null;
            this._dragGrabActor = null;
        }

        _onAnyDragEnd() {
            this._dragActive = false;
            this._releaseDragGrab();
            this._cancelPreview();
            this._sweepSlideWatches();
            // Without a write no layout pass follows, so a cancel puts the
            // arrangement back by hand.
            if (!this._dropAccepted)
                this._restoreDragOrder();
            this._dragOrder = null;
            this._dropAccepted = false;
            if (this._layoutAfterDrag) {
                this._layoutAfterDrag = false;
                this._queueUpdateLayout();
            }

            if (!this._menuRemovedForDrag)
                return;
            this._menuRemovedForDrag = false;
            this._toggleButton.applyHoverMenuOrder();

            // A reorder fires no app action, keep-popup-after-click has no
            // say here. DND pops its own grab right after this handler, so
            // the regrab waits a turn.
            debounceTo(this, '_menuRegrabId', MENU_REGRAB_DELAY_MS, () => {
                this._overflowMenu.attachToManager();
                // Reorder before the grab comes back, the hover switch picks
                // the first match even while the popup is open.
                this._toggleButton.applyHoverMenuOrder(true);
                this._overflowMenu.restoreManagerGrab();
            });
        }

        // After a commit the dragged icon owns the slot under the pointer,
        // so a move cannot trigger its own reversal.
        handleDragOver(source, dragActor, _x, _y, _time) {
            const actor = getDraggableFromSource(source)?.getDragActorSource?.();
            if (!actor)
                return DND.DragMotionResult.NO_DROP;

            const [sx, sy] = dragStageCoords(dragActor);
            const current = this._iconsInVisualOrder().map(entry => entry.actor);
            const target = this._dropSlotAt(actor, current, sx, sy);
            const order = current.slice();
            order.splice(order.indexOf(actor), 1);
            order.splice(target, 0, actor);

            if (sameOrder(order, current)) {
                this._cancelPreview();
            } else if (!this._pendingOrder || (!sameOrder(order, this._pendingOrder) &&
                Math.hypot(sx - this._pendingAnchor[0], sy - this._pendingAnchor[1]) >= DRAG_RETARGET_TRAVEL_PX)) {
                this._pendingOrder = order;
                this._pendingAnchor = [sx, sy];
                debounceTo(this, '_dwellId', DRAG_MOVE_DWELL_MS, () => this._commitPreview());
            }
            return DND.DragMotionResult.MOVE_DROP;
        }

        _commitPreview() {
            this._applyPending(true);
        }

        // Applies the newest target right away, so the write matches the
        // release position.
        _flushPreview() {
            this._applyPending(false);
        }

        _applyPending(slide) {
            const order = this._pendingOrder;
            this._cancelPreview();
            if (order && this._dragActive)
                this._placeIntoContainers(order, slide);
        }

        _cancelPreview() {
            clearIds(this, removeTimer, '_dwellId');
            this._pendingOrder = null;
            this._pendingAnchor = null;
        }

        acceptDrop(source, _dragActor, _x, _y, _time) {
            const draggableItem = getDraggableFromSource(source);
            const actor = draggableItem?.getDragActorSource?.();
            if (!actor || !draggableItem.appId)
                return false;

            this._flushPreview();
            const entries = this._iconsInVisualOrder();
            const dropped = entries.findIndex(entry => entry.actor === actor);
            if (dropped === -1)
                return false;

            // Icons sharing an appId share one priority, passing every
            // member would order their block by the wrong one.
            const {appId} = entries[dropped];
            setAppPriorities(this._settings, entries
                .filter((entry, i) => i === dropped || entry.appId !== appId)
                .map(entry => entry.appId));

            this._dropAccepted = true;
            return true;
        }

        // Over the popup the slot starts behind the inline icons, otherwise
        // the split would pull the drop straight back into the panel.
        _dropSlotAt(dragged, current, x, y) {
            const overflow = this._overflowMenu.container;
            if (this._overflowMenu.isOpen && isPointInActor(x, y, overflow)) {
                const grid = current.filter(actor => actor.get_parent() === overflow);
                return current.length - grid.length + slotIndexAt(grid, x, y, dragged);
            }
            const row = current.filter(actor => actor.get_parent() === this._visibleBox);
            return slotIndexAt(row, x, y);
        }

        _visibleCountFor(total) {
            return Math.min(total, this._settings.get_int('visible-icon-limit'));
        }

        // The one rule that decides panel versus popup, with a second rule
        // a drop into the popup would come straight back inline.
        _placeIntoContainers(actors, slide = false) {
            const visibleCount = this._visibleCountFor(actors.length);
            let staggered = 0;
            actors.forEach((actor, index) => {
                const inline = index < visibleCount;
                const parent = inline ? this._visibleBox : this._overflowMenu.container;
                if (slide) {
                    this._slideFromCurrent(actor, staggered++ * DRAG_SLIDE_STAGGER_MS);
                } else {
                    // A reparent kills a running slide mid-value, the icon
                    // would stay stuck at the leftover offset.
                    actor.remove_transition('translation-x');
                    actor.remove_transition('translation-y');
                    actor.set_translation(0, 0, 0);
                }
                moveActorToIndex(actor, parent,
                    inline ? index : index - visibleCount);
            });
        }

        // The tree commits at once, the icon paints at its old spot via a
        // translation easing to zero. Translations never fight a layout
        // pass, and stage deltas let icons glide across the containers.
        _slideFromCurrent(actor, delay) {
            // A never-allocated actor has no old spot to slide from, its
            // box is garbage.
            if (!actor.has_allocation())
                return;
            const [beforeX, beforeY] = actor.get_transformed_position();
            const stale = this._slideWatches.get(actor);
            if (stale)
                actor.disconnect(stale);
            // An unchanged box emits nothing, the sweep in _onAnyDragEnd
            // picks those watches up.
            const id = actor.connect('notify::allocation', () => {
                actor.disconnect(id);
                this._slideWatches.delete(actor);
                const [afterX, afterY] = actor.get_transformed_position();
                const dx = beforeX - afterX + actor.translation_x;
                const dy = beforeY - afterY + actor.translation_y;
                if (!dx && !dy)
                    return;
                actor.translation_x = dx;
                actor.translation_y = dy;
                actor.ease({
                    translation_x: 0,
                    translation_y: 0,
                    duration: DRAG_SLIDE_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    delay,
                });
            });
            this._slideWatches.set(actor, id);
        }

        _sweepSlideWatches() {
            for (const [actor, id] of this._slideWatches) {
                if (!isDisposed(actor))
                    actor.disconnect(id);
            }
            this._slideWatches.clear();
        }

        // Reads back the order the user sees. Unidentified icons stay in so
        // a preview or a cancel can place them, only the write drops them.
        _iconsInVisualOrder() {
            const entries = [];
            for (const container of [this._visibleBox, this._overflowMenu.container]) {
                for (const actor of container.get_children()) {
                    if (actor.visible)
                        entries.push({appId: actor._appId ?? null, actor});
                }
            }
            return entries;
        }

        _restoreDragOrder() {
            const order = (this._dragOrder ?? [])
                .filter(actor => !isDisposed(actor) && actor.get_parent());
            if (order.length)
                this._placeIntoContainers(order);
        }

        // destroy() and the destroy signal both land here, either can come
        // first. Two separate lists drifted apart before and left timers
        // running past disable().
        _teardown() {
            disconnectSignal(this, this, '_destroyHandlerId');
            clearIds(this, removeTimer,
                '_layoutUpdateId', '_settleTimeoutId', '_menuRegrabId', '_reopenPopupId', '_hoverOrderId');
            this._releaseDragGrab();
            this._cancelPreview();
            this._sweepSlideWatches();
        }

        destroy() {
            this._teardown();
            clearVisibleOrder();
            disconnectAll(this, this._settings, '_settingsSignals');
            disposeAll(this, 'disconnect', '_colorSetWatch');

            this._menuRemovedForDrag = false;

            disposeAll(this, 'destroy',
                '_overflowMenu',
                '_visibleBox',
                '_toggleButton'
            );
            clearIds(this, removeTimer, '_hoverOrderId');

            this._icons.clear();
            super.destroy();
        }
    });

function sameOrder(a, b) {
    return a.length === b.length && a.every((actor, i) => actor === b[i]);
}
