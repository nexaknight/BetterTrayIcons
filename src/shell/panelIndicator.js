import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getAppConfigs, setAppConfigValue} from '../shared/appConfig.js';
import {clearIds, disconnectAll, disconnectSignal, disposeAll, removeTimer} from '../shared/lifecycle.js';
import {safelyReparentActor, isDisposed, computeToggleStyle} from './utils/actor.js';
import {
    getDraggableFromSource,
    isPointInActor,
    nearestRowIndex,
    nearestGridIndex,
    dragStageCoords,
} from './utils/dropTarget.js';
import {OverflowMenu} from './overflowMenu.js';
import {ClickController} from './features/clickController.js';
import {DragPlaceholder} from './features/dragAndDrop.js';
import {
    LAYOUT_UPDATE_DELAY_MS,
    GEOMETRY_SETTLE_MS,
    PRIORITY_STEP,
} from '../const.js';

export const PanelIndicator = GObject.registerClass(
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

            this._destroyHandlerId = this.connect('destroy', () => {
                clearIds(this, removeTimer, '_layoutUpdateId', '_settleTimeoutId');
            });

            this._settings = settings;
            this._openPreferences = openPreferences;
            this._icons = new Map();

            this._clickController = null;
            this._layoutUpdateId = 0;
            this._settleTimeoutId = 0;
            this._overflowMenu = null;
            this._actionMenu = null;
            this._actionMenuOverflowItem = null;

            this._dragPlaceholder = new DragPlaceholder();
            this._menuRemovedForDrag = false;

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

            this._toggleIcon = new St.Icon({
                icon_name: this._settings.get_string('toggle-icon-name'),
                style_class: 'system-status-icon',
            });

            this._toggleButton = new St.Button({
                child: this._toggleIcon,
                style_class: 'panel-button better-tray-toggle-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_expand: false,
                y_expand: true,
                y_align: Clutter.ActorAlign.FILL,
                x_align: Clutter.ActorAlign.CENTER,
            });

            this._toggleButton.connect('notify::hover', () => this._updateToggleState());
            this.add_child(this._toggleButton);

            this._overflowMenu = new OverflowMenu(this._settings, this._toggleButton, () => {
                this._updateToggleState();
            });
            // Container's _delegate routes DND drop events back to this.
            this._overflowMenu.container._delegate = this;

            // Toggle button stops click events from reaching the panel.
            // Tray items pass events through so middle-click and DnD still work.
            this._clickController = new ClickController(
                this._toggleButton,
                this._settings,
                'toggle',
                action => this._executeAction(action),
                {propagateEvent: false}
            );

            const queueLayout = () => this._queueUpdateLayout();

            this._settingsSignals = [];
            const LAYOUT_KEYS = [
                'overflow-layout-mode',
                'grid-column-limit',
                'visible-icon-limit',
                'toggle-position',
                'app-configs',
            ];
            for (const key of LAYOUT_KEYS)
                this._settingsSignals.push(this._settings.connect(`changed::${key}`, queueLayout));


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
            if (!actor._appId)
                actor._appId = id;
            this._icons.set(id, actor);
            this._queueUpdateLayout();
        }

        removeIcon(id) {
            if (!this._icons.has(id))
                return;
            this._icons.delete(id);
            this._queueUpdateLayout();
        }

        _executeAction(action) {
            const handlers = {
                'toggle': () => this._overflowMenu.toggle(),
                'cycle': () => this._cycleIcons(),
                'action-menu': () => this._openActionMenu(),
                'prefs': () => this._openPreferences(),
            };
            handlers[action]?.();
        }

        // SNI/XEmbed click handler. The action itself (Activate, Secondary)
        // is fired by the icon; this only decides what the overflow popup
        // should do afterwards.
        _handleIconClick() {
            if (!this._overflowMenu)
                return;
            if (this._settings.get_boolean('keep-popup-after-click')) {
                // The SNI action may shift focus (e.g. raises a window),
                // which drops Shell's modal grab and closes the popup. Defer
                // a re-open so it survives the focus transition.
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this._overflowMenu && !this._overflowMenu.isOpen &&
                        this._settings?.get_boolean('keep-popup-after-click'))
                        this._overflowMenu.open();

                    return GLib.SOURCE_REMOVE;
                });
            } else if (this._overflowMenu.isOpen) {
                this._overflowMenu.close();
            }
        }

        _cycleIcons() {
            const configs = getAppConfigs(this._settings);
            const configMap = {};
            configs.forEach(c => {
                configMap[c.id] = c;
            });

            const allItems = [];
            for (const [id, actor] of this._icons) {
                if (isDisposed(actor))
                    continue;
                const appId = actor._appId || id;
                const config = configMap[appId];
                if (config && config.is_hidden)
                    continue;
                const priority = config?.priority ?? 0;
                allItems.push({appId, priority});
            }

            if (allItems.length < 2)
                return;

            allItems.sort((a, b) => b.priority - a.priority);

            const rotated = allItems.shift();
            allItems.push(rotated);

            // PRIORITY_STEP gaps leave room for manual inserts via the prefs UI.
            let nextPriority = allItems.length * PRIORITY_STEP;
            allItems.forEach(item => {
                setAppConfigValue(this._settings, item.appId, 'priority', nextPriority);
                nextPriority -= PRIORITY_STEP;
            });
        }

        _openActionMenu() {
            this._ensureActionMenu();
            if (this._actionMenuOverflowItem)
                this._actionMenuOverflowItem.setSensitive(!!this._toggleButton?.visible);

            this._actionMenu.toggle();
        }

        _ensureActionMenu() {
            if (this._actionMenu)
                return;

            this._actionMenu = new PopupMenu.PopupMenu(this._toggleButton, 0.5, St.Side.TOP);
            this._actionMenu.actor.add_style_class_name('panel-menu');
            Main.layoutManager.uiGroup.add_child(this._actionMenu.actor);
            this._actionMenu.actor.hide();

            if (Main.panel.menuManager)
                Main.panel.menuManager.addMenu(this._actionMenu);


            this._actionMenuOverflowItem = new PopupMenu.PopupMenuItem(_('Open Overflow Menu'));
            this._actionMenuOverflowItem.connect('activate', () => {
                this._actionMenu.close();
                if (this._toggleButton?.visible)
                    this._overflowMenu.open();
            });
            this._actionMenu.addMenuItem(this._actionMenuOverflowItem);

            const prefsItem = new PopupMenu.PopupMenuItem(_('Open Settings'));
            prefsItem.connect('activate', () => {
                this._actionMenu.close();
                this._openPreferences();
            });
            this._actionMenu.addMenuItem(prefsItem);
        }

        _queueUpdateLayout() {
            clearIds(this, removeTimer, '_layoutUpdateId');
            this._layoutUpdateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LAYOUT_UPDATE_DELAY_MS, () => {
                this._layoutUpdateId = 0;
                this._updateLayout();
                return GLib.SOURCE_REMOVE;
            });
        }

        _updateLayout() {
            // The pending timer can still fire after C-side disposal of
            // children even when JS refs look non-null.
            if (isDisposed(this) || isDisposed(this._visibleBox) ||
                isDisposed(this._toggleButton) || !this._overflowMenu)
                return;
            this._hideDragPlaceholder();

            const limit = this._settings.get_int('visible-icon-limit');
            const togglePos = this._settings.get_string('toggle-position');
            const configs = getAppConfigs(this._settings);

            if (this._overflowMenu.layoutNeedsRecreate()) {
                this._overflowMenu.recreateContainer();
                // Container was rebuilt, so re-route DND drop events.
                this._overflowMenu.container._delegate = this;
                this._overflowMenu.applyStyle(this._enableCustomStyle);
            }

            if (!this._overflowMenu.container)
                return;

            const configMap = {};
            configs.forEach(c => {
                configMap[c.id] = c;
            });

            const validIcons = [];
            for (const [id, actor] of this._icons) {
                if (actor && actor.get_parent && !isDisposed(actor)) {
                    const appId = actor._appId || id;
                    const config = configMap[appId];
                    const isHidden = config && config.is_hidden;

                    actor.visible = !isHidden;
                    if (!isHidden) {
                        const priority = config?.priority || 0;
                        validIcons.push({actor, priority, id});
                    }
                } else {
                    this._icons.delete(id);
                }
            }

            validIcons.sort((a, b) => b.priority - a.priority);
            const sortedActors = validIcons.map(obj => obj.actor);

            const visibleCount = Math.min(sortedActors.length, limit);
            const visibleIcons = sortedActors.slice(0, visibleCount);
            const overflowIcons = sortedActors.slice(visibleCount);
            const hasOverflow = overflowIcons.length > 0;

            if (this._visibleBox.get_parent() === this)
                this.remove_child(this._visibleBox);
            if (this._toggleButton.get_parent() === this)
                this.remove_child(this._toggleButton);

            if (hasOverflow) {
                this._overflowMenu.attachToManager();
                this._toggleButton.show();
            } else {
                this._overflowMenu.close();
                this._overflowMenu.detachFromManager();
                this._toggleButton.hide();
            }

            visibleIcons.forEach(icon => safelyReparentActor(icon, this._visibleBox));
            overflowIcons.forEach(icon => safelyReparentActor(icon, this._overflowMenu.container));

            this._overflowMenu.updateGeometry(overflowIcons.length);

            clearIds(this, removeTimer, '_settleTimeoutId');
            this._settleTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GEOMETRY_SETTLE_MS, () => {
                this._settleTimeoutId = 0;
                this._overflowMenu.updateGeometry();
                return GLib.SOURCE_REMOVE;
            });

            if (hasOverflow) {
                if (togglePos === 'left') {
                    this.add_child(this._toggleButton);
                    this.add_child(this._visibleBox);
                } else {
                    this.add_child(this._visibleBox);
                    this.add_child(this._toggleButton);
                }
            } else {
                this.add_child(this._visibleBox);
                this.add_child(this._toggleButton);
            }
        }

        _updateStyle() {
            if (!this._toggleIcon || !this._toggleButton || !this._settings)
                return;

            const iconName = this._settings.get_string('toggle-icon-name') || 'view-more-symbolic';
            if (this._toggleIcon.icon_name !== iconName)
                this._toggleIcon.icon_name = iconName;

            const customToggle = this._settings.get_boolean('enable-custom-toggle-style');
            if (customToggle) {
                this._toggleButton.remove_style_class_name('panel-button');
                this._toggleIcon.remove_style_class_name('system-status-icon');
            } else {
                this._toggleButton.add_style_class_name('panel-button');
                this._toggleIcon.add_style_class_name('system-status-icon');
            }

            const style = computeToggleStyle(this._settings);
            this._toggleBaseStyle = style.baseStyle;
            this._toggleHoverStyle = style.hoverStyle;
            this._toggleIconColor = style.iconColor;
            this._toggleIconHoverColor = style.iconHoverColor;

            this._toggleIcon.set_icon_size(this._settings.get_int('toggle-icon-size') || 20);
            this._toggleIcon.set_style(this._toggleIconColor ? `color: ${this._toggleIconColor};` : '');
            this._toggleButton.set_style(this._toggleBaseStyle);

            this._enableCustomStyle = this._settings.get_boolean('enable-custom-overflow-style');
            this._overflowMenu?.applyStyle(this._enableCustomStyle);

            this._updateToggleState();
        }

        _updateToggleState() {
            const isMenuOpen = this._overflowMenu?.isOpen;
            const isHover = this._toggleButton.hover;
            const isActive = isMenuOpen || isHover;

            if (this._toggleBaseStyle) {
                if (isActive) {
                    this._toggleButton.set_style(`${this._toggleBaseStyle} ${this._toggleHoverStyle}`);
                    if (this._toggleIcon && this._toggleIconHoverColor)
                        this._toggleIcon.set_style(`color: ${this._toggleIconHoverColor};`);
                } else {
                    this._toggleButton.set_style(this._toggleBaseStyle);
                    if (this._toggleIcon && this._toggleIconColor)
                        this._toggleIcon.set_style(`color: ${this._toggleIconColor};`);
                }
            } else if (isMenuOpen) {
                this._toggleButton.add_style_pseudo_class('active');
            } else {
                this._toggleButton.remove_style_pseudo_class('active');
            }
        }

        // Order matters: if menu was opened normally, manager holds `_grab`
        // and `activeMenu`. removeMenu only nulls `_grab`, so the next emit calls
        // Main.popModal(null) and throws "incorrect pop". Close first to clear both.
        // The detach-and-reopen path runs without manager-grab so DND keeps its own grab.
        _onAnyDragBegin() {
            if (!this._toggleButton?.visible || !this._overflowMenu)
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

        _onAnyDragEnd() {
            this._hideDragPlaceholder();
            if (this._overflowMenu?.isOpen)
                this._overflowMenu.close();

            if (this._menuRemovedForDrag) {
                this._menuRemovedForDrag = false;
                this._overflowMenu?.attachToManager();
            }
        }

        handleDragOver(source, dragActor, _x, _y, _time) {
            const draggableItem = getDraggableFromSource(source);
            if (!draggableItem)
                return DND.DragMotionResult.NO_DROP;

            const [sx, sy] = dragStageCoords(dragActor);
            this._updateDragPlaceholder(sx, sy);
            return DND.DragMotionResult.MOVE_DROP;
        }

        acceptDrop(source, dragActor, _x, _y, _time) {
            this._hideDragPlaceholder();

            const draggableItem = getDraggableFromSource(source);
            if (!draggableItem?.appId)
                return false;

            const draggedAppId = draggableItem.appId;
            const items = this._getDropTargetIcons();

            const currentIndex = items.findIndex(i => i.appId === draggedAppId);
            if (currentIndex === -1)
                return false;

            const [sx, sy] = dragStageCoords(dragActor);
            let targetIndex = this._computeInsertIndex(items, sx, sy);
            if (targetIndex > currentIndex)
                targetIndex--;

            const [moved] = items.splice(currentIndex, 1);
            items.splice(targetIndex, 0, moved);

            // Priorities go from high to low. PRIORITY_STEP gaps leave room
            // for manual inserts via the prefs UI.
            let nextPriority = items.length * PRIORITY_STEP;
            items.forEach(item => {
                setAppConfigValue(this._settings, item.appId, 'priority', nextPriority);
                nextPriority -= PRIORITY_STEP;
            });

            return true;
        }

        _updateDragPlaceholder(x, y) {
            const items = this._getDropTargetIcons();
            if (items.length === 0) {
                this._hideDragPlaceholder();
                return;
            }
            this._dragPlaceholder.showAt(items, this._computeInsertIndex(items, x, y));
        }

        _hideDragPlaceholder() {
            this._dragPlaceholder?.hide();
        }

        _getDropTargetIcons() {
            const configs = getAppConfigs(this._settings);
            const configMap = Object.fromEntries(configs.map(c => [c.id, c]));

            const items = [];
            for (const [id, actor] of this._icons) {
                if (isDisposed(actor) || !actor.visible || !actor.get_parent())
                    continue;
                const appId = actor._appId || id;
                const conf = configMap[appId] || {};
                if (conf.is_hidden)
                    continue;
                items.push({appId, actor, priority: conf.priority ?? 0});
            }
            items.sort((a, b) => b.priority - a.priority);
            return items;
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

        destroy() {
            disconnectSignal(this, this, '_destroyHandlerId');
            clearIds(this, removeTimer, '_layoutUpdateId', '_settleTimeoutId');
            disconnectAll(this, this._settings, '_settingsSignals');

            this._menuRemovedForDrag = false;

            // The action menu also needs detaching from Main.panel.menuManager
            // before it's destroyed.
            if (this._actionMenu) {
                try {
                    Main.panel.menuManager?.removeMenu(this._actionMenu);
                } catch { /* not in manager */ }
            }

            disposeAll(this, 'destroy',
                '_clickController',
                '_overflowMenu',
                '_actionMenu',
                '_dragPlaceholder',
                '_visibleBox',
                '_toggleButton'
            );
            this._actionMenuOverflowItem = null;

            this._icons.clear();
            super.destroy();
        }
    });
