import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {getAppConfigMap, setAppPriorities, byPriorityThenAppId} from '../../shared/appConfig.js';
import {clearIds, debounceTo, disconnectAll, disconnectSignal, disposeAll, removeTimer} from '../../shared/lifecycle.js';
import {safelyReparentActor, isDisposed, trackDisposal} from '../utils/actor.js';
import {
    getDraggableFromSource,
    isPointInActor,
    nearestRowIndex,
    nearestGridIndex,
    dragStageCoords,
} from './dropTarget.js';
import {OverflowMenu} from './overflowMenu.js';
import {ToggleButton} from './toggleButton.js';
import {DragPlaceholder} from '../features/dragPlaceholder.js';

const LAYOUT_UPDATE_DELAY_MS = 100;

// Zero waits for the next main loop turn, which is all it takes for DND to
// release its own grab after a drop.
const MENU_REGRAB_DELAY_MS = 0;

const GEOMETRY_SETTLE_MS = 50;

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
            this._overflowMenu = null;

            this._dragPlaceholder = new DragPlaceholder();
            this._menuRemovedForDrag = false;
            this._dragGrabActor = null;
            this._dragItems = null;
            this._dragActive = false;
            this._layoutAfterDrag = false;

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

            this._overflowMenu = new OverflowMenu(this._settings, this._toggleButton.actor, () => {
                this._toggleButton.updateState();
            });
            // Container's _delegate routes DND drop events back to this.
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

            this._enableCustomStyle = false;

            this._updateStyle();
            this._queueUpdateLayout();

            this._delegate = this;
        }

        addIcon(id, actor) {
            if (this._icons.has(id))
                return;
            this._icons.set(id, actor);
            this._dragItems = null;
            this._queueUpdateLayout();
        }

        removeIcon(id) {
            if (!this._icons.has(id))
                return;
            this._icons.delete(id);
            this._dragItems = null;
            this._queueUpdateLayout();
            this._onIconsChanged?.(id);
        }

        setIconsChangedHandler(callback) {
            this._onIconsChanged = callback;
        }

        // The icon fires the SNI action itself, this only decides what the
        // overflow popup does afterwards.
        _handleIconClick() {
            if (!this._overflowMenu)
                return;
            if (this._settings.get_boolean('keep-popup-after-click')) {
                // The SNI action may shift focus, e.g. raise a window, which
                // drops Shell's modal grab and closes the popup.
                clearIds(this, removeTimer, '_reopenPopupId');
                this._reopenPopupId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._reopenPopupId = 0;
                    if (this._overflowMenu && !this._overflowMenu.isOpen &&
                        this._settings?.get_boolean('keep-popup-after-click'))
                        this._overflowMenu.open();

                    return GLib.SOURCE_REMOVE;
                });
            } else if (this._overflowMenu.isOpen) {
                this._overflowMenu.close();
            }
        }

        // Rotate only the visible icons. Including passive and wine-off ones
        // would write the blob for a reorder the eye never sees.
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
            const toggleActor = this._toggleButton?.actor;
            // The pending timer can still fire after C-side disposal of
            // children even when JS refs look non-null.
            if (isDisposed(this) || isDisposed(this._visibleBox) ||
                isDisposed(toggleActor) || !this._overflowMenu)
                return;
            // A drag holds its own grab with the popup detached, and the drag
            // actor must stay where DND parked it. Rerun after the drop.
            if (this._dragActive) {
                this._layoutAfterDrag = true;
                return;
            }
            this._hideDragPlaceholder();

            this._dragItems = null;
            const limit = this._settings.get_int('visible-icon-limit');
            const togglePos = this._settings.get_string('toggle-position');
            const wineEnabled = this._settings.get_boolean('enable-wine-support');

            if (!this._overflowMenu.container)
                return;

            const sortedActors = [];
            for (const {actor, config} of this._liveIconEntries()) {
                // XEmbed wrappers stay registered while Wine support is
                // off, and Passive items stay registered while idle, so
                // the layout must not resurrect either.
                const isHidden = config?.is_hidden ||
                    (actor._isXembed && !wineEnabled) ||
                    actor._isPassive;

                actor.visible = !isHidden;
                if (!isHidden)
                    sortedActors.push(actor);
            }

            const visibleCount = Math.min(sortedActors.length, limit);
            const visibleIcons = sortedActors.slice(0, visibleCount);
            const overflowIcons = sortedActors.slice(visibleCount);
            const hasOverflow = overflowIcons.length > 0;

            if (hasOverflow) {
                this._overflowMenu.attachToManager();
                toggleActor.show();
                this._toggleButton.applyHoverMenuOrder();
            } else {
                this._overflowMenu.close();
                this._overflowMenu.detachFromManager();
                toggleActor.hide();
            }

            visibleIcons.forEach(icon => safelyReparentActor(icon, this._visibleBox));
            overflowIcons.forEach(icon => safelyReparentActor(icon, this._overflowMenu.container));

            this._overflowMenu.updateGeometry(overflowIcons.length);

            debounceTo(this, '_settleTimeoutId', GEOMETRY_SETTLE_MS, () => this._overflowMenu.updateGeometry());

            // Ordering by remove_child plus add_child unmaps the toggle for as
            // long as it sits outside the tree, and PopupMenu closes itself the
            // moment its source actor goes unmapped (js/ui/popupMenu.js, the
            // notify::mapped handler on sourceActor). The toggle is exactly
            // that source actor, so a relayout during an open popup shut it,
            // which is what a drop does through its own reorder.
            // set_child_at_index moves a child already in place instead.
            const order = hasOverflow && togglePos === 'left'
                ? [toggleActor, this._visibleBox]
                : [this._visibleBox, toggleActor];

            order.forEach((child, index) => {
                if (child.get_parent() === this)
                    this.set_child_at_index(child, index);
                else
                    this.insert_child_at_index(child, index);
            });

            this._lastLayoutSignature = this._computeLayoutSignature();
        }

        _computeLayoutSignature() {
            const configMap = getAppConfigMap(this._settings);

            const parts = [];
            for (const [id, actor] of this._icons) {
                // Keyed by the item, not the app: this only ever gets compared
                // to the previous signature, and two items can share an appId.
                const appId = actor?._appId;
                const c = appId && configMap[appId];
                parts.push(`${id}:${c?.is_hidden ? 1 : 0}:${c?.priority ?? 0}`);
            }
            parts.sort();
            return parts.join('|');
        }

        _updateStyle() {
            if (!this._toggleButton || !this._settings)
                return;

            this._toggleButton.updateStyle();

            this._enableCustomStyle = this._settings.get_boolean('enable-custom-overflow-style');
            this._overflowMenu?.applyStyle(this._enableCustomStyle);
            // applyStyle measures the children before a shrink has relaid
            // them out, so the old width wins the max. Measure again settled.
            debounceTo(this, '_settleTimeoutId', GEOMETRY_SETTLE_MS, () => this._overflowMenu?.updateGeometry());
        }

        // Order matters: if menu was opened normally, manager holds `_grab` and `activeMenu`.
        // removeMenu only nulls `_grab`, so the next emit calls Main.popModal(null)
        // and throws "incorrect pop". Close first to clear both.
        // The detach-and-reopen path runs without manager-grab so DND keeps its own grab.
        _onAnyDragBegin() {
            this._dragActive = true;
            this._claimDragGrab();

            if (!this._toggleButton?.actor?.visible || !this._overflowMenu)
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

        // DND grabs a bare actor parked in uiGroup, so auto-hiding panels
        // (Dash to Panel) see no grab of their own and hide mid-drag, taking
        // the popup and the drop target with them. _sourceActor is how the
        // shell links a grab back to the actor it belongs to, which for this
        // drag is us, sitting in the panel.
        _claimDragGrab() {
            const grabActor = global.stage.get_grab_actor();
            if (!grabActor || grabActor._sourceActor)
                return;
            grabActor._sourceActor = this;
            this._dragGrabActor = grabActor;
        }

        // The grab actor is shared by every drag in the shell, so the tag
        // must come off or unrelated drags would keep claiming to be ours.
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
            this._dragItems = null;
            this._hideDragPlaceholder();
            if (this._layoutAfterDrag) {
                this._layoutAfterDrag = false;
                this._queueUpdateLayout();
            }

            if (!this._menuRemovedForDrag)
                return;
            this._menuRemovedForDrag = false;
            this._toggleButton?.applyHoverMenuOrder();

            // Not gated on keep-popup-after-click: that setting is about a
            // click that fires an icon's own action, and closing the popup
            // then is the point. A reorder only rearranges the popup itself,
            // so it stays up for the next drag either way.
            //
            // The popup never really left, it only lost its manager grab for
            // the drag. DND pops its own grab right after this handler
            // returns, so taking ours now would pop out of order.
            debounceTo(this, '_menuRegrabId', MENU_REGRAB_DELAY_MS, () => {
                this._overflowMenu?.attachToManager();
                this._overflowMenu?.restoreManagerGrab();
            });
        }

        handleDragOver(source, dragActor, _x, _y, _time) {
            const draggableItem = getDraggableFromSource(source);
            if (!draggableItem)
                return DND.DragMotionResult.NO_DROP;

            // Snapshot once per drag, this fires per pointer motion event.
            // addIcon/removeIcon drop the snapshot when the set changes mid-drag.
            this._dragItems ??= this._collectIconEntries(true);

            const [sx, sy] = dragStageCoords(dragActor);
            this._updateDragPlaceholder(this._dragItems, sx, sy);
            return DND.DragMotionResult.MOVE_DROP;
        }

        acceptDrop(source, dragActor, _x, _y, _time) {
            this._hideDragPlaceholder();

            const draggableItem = getDraggableFromSource(source);
            if (!draggableItem?.appId)
                return false;

            const items = this._dragItems ?? this._collectIconEntries(true);
            this._dragItems = null;

            // Matched by actor, not by appId: several icons can carry the same
            // one, and then the first match is not the icon being dragged.
            const draggedActor = draggableItem.getDragActorSource();
            const currentIndex = items.findIndex(i => i.actor === draggedActor);
            if (currentIndex === -1)
                return false;

            const [sx, sy] = dragStageCoords(dragActor);
            let targetIndex = this._computeInsertIndex(items, sx, sy);
            if (targetIndex > currentIndex)
                targetIndex--;

            const [moved] = items.splice(currentIndex, 1);
            items.splice(targetIndex, 0, moved);

            // Icons sharing an appId share one priority, so their group moves
            // as a block. Passing every member would order the block by the one
            // the user did not touch.
            setAppPriorities(this._settings, items
                .filter((item, i) => i === targetIndex || item.appId !== moved.appId)
                .map(item => item.appId));

            return true;
        }

        _updateDragPlaceholder(items, x, y) {
            if (items.length === 0) {
                this._hideDragPlaceholder();
                return;
            }
            this._dragPlaceholder.showAt(items, this._computeInsertIndex(items, x, y));
        }

        _hideDragPlaceholder() {
            this._dragPlaceholder?.hide();
        }

        _computeInsertIndex(items, x, y) {
            const overflowContainer = this._overflowMenu?.container;
            const visibleItems = items.filter(i => i.actor.get_parent() === this._visibleBox);
            const overflowItems = items.filter(i => i.actor.get_parent() === overflowContainer);

            const inOverflow = this._overflowMenu?.isOpen &&
                isPointInActor(x, y, overflowContainer);

            if (inOverflow && overflowItems.length > 0) {
                const localIdx = nearestGridIndex(overflowItems, x, y);
                return visibleItems.length + localIdx;
            }
            return nearestRowIndex(visibleItems, x);
        }

        // Both the destroy signal and destroy() land here, and either can come
        // first: disable() calls destroy(), while a parent tearing the actor
        // down only ever emits the signal. Keeping one list is the point, two
        // drifted apart before and left timers running past disable().
        _teardown() {
            disconnectSignal(this, this, '_destroyHandlerId');
            clearIds(this, removeTimer,
                '_layoutUpdateId', '_settleTimeoutId', '_menuRegrabId', '_reopenPopupId');
            this._releaseDragGrab();
        }

        destroy() {
            this._teardown();
            disconnectAll(this, this._settings, '_settingsSignals');

            this._menuRemovedForDrag = false;

            disposeAll(this, 'destroy',
                '_overflowMenu',
                '_dragPlaceholder',
                '_visibleBox',
                '_toggleButton'
            );

            this._icons.clear();
            super.destroy();
        }
    });

