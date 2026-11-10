import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Gettext from 'gettext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getAppConfigMap, byPriorityThenAppId, setAppPriorities} from '../../shared/appConfig.js';
import {warnOnce} from '../../shared/logging.js';
import {clearIds, debounceTo, disconnectAll, disconnectSignal, removeTimer} from '../../shared/lifecycle.js';
import {isDisposed, watchDisposal} from '../disposal.js';
import {moveActorToIndex} from '../actorPlacement.js';
import {pickAppId} from '../identity/appId.js';
import {joinCollapsible, keepsOverflowOpen, menuManagerFor, overlayScrollbar, quickSettingsRoom, setStylePart, POPUP_ANIMATION_FULL} from '../popupMenus.js';
import {BackgroundAppsProxyIcon} from '../backgroundAppsProxy/backgroundAppsProxyIcon.js';
import {ClickController, dragThreshold, TRAY_ACTION_PREFIX} from '../features/clickController.js';
import {forwardDragStateToIndicator, isDragEnabledFromSettings} from '../features/dragAndDrop.js';
import {BACKGROUND_TOGGLE_WAIT_MS, backgroundAppsToggles} from '../features/backgroundApps.js';
import {connectPanelCopies, disconnectPanelCopies} from '../panelCopies.js';

const LAYOUT_UPDATE_DELAY_MS = 100;

// The class of the shell's expander rows, so a theme styles ours like one
const EXPANDER_ROW_CLASS = 'popup-submenu-menu-item';

// The dragged row stays in the list as a faint placeholder
const DRAG_PLACEHOLDER_OPACITY = 60;
const FULL_OPACITY = 255;

const DRAG_CLONE_CSS = 'padding: 0; margin: 0;';

const LAYOUT_KEYS = Object.freeze(['enable-wine-support', 'app-configs']);

const REPICK_NUDGE_PX = 1;

const ESCAPE_FOLD_ACTION = 'bettertrayicons-fold-on-escape';

// Tells our visibility override apart from the shell's own method
const SYNC_OVERRIDE_MARK = Symbol('bettertrayicons-sync-override');

// The swallowed click is replayed once its button is up, a held press past
// this is a drag the replay cannot rebuild anyway
const REPLAY_POLL_MS = 10;
const REPLAY_WAIT_MS = 2000;

const DRAG_SCROLL_EDGE_PX = 24;
const DRAG_SCROLL_STEP_PX = 8;

// Markers and no-ops, nothing for the item to run
const IGNORED_ACTIONS = new Set(['nothing', 'drag-drop']);

// The count reads like the shell's own, translations included
const SHELL_DOMAIN = 'gnome-shell';

const DESKTOP_SUFFIX_RE = /\.desktop$/;

// Each tray item and each app the portal lists gets its own row in the shell's
// Background Apps menu, and the shell's rows hide meanwhile. Relies on the private
// _backgroundApps, _syncVisibility, _listTitle, _appsSection, _clickGesture and _delegate.
export class BackgroundAppsHost {
    constructor(settings, openPreferences) {
        this._settings = settings;
        this._openPreferences = openPreferences;
        this._icons = new Map();
        this._trayRows = new Map();
        this._portalRows = new Map();
        this._portalIcons = new Map();
        this._trayOrder = [];
        this._toggle = null;
        this._section = null;
        this._prefsItem = null;
        this._attachments = new Map();
        this._quickSettings = null;
        this._copiesChangedId = 0;
        this._shownCount = 0;
        this._inline = null;
        this._layoutUpdateId = 0;
        this._findToggleId = 0;
        this._mergeId = 0;
        this._reopenId = 0;
        this._inlineDropId = 0;
        this._closeMenusId = 0;
        this._press = null;
        this._drag = null;
        this._keyFocusSignalId = 0;
        this._menuSignalId = 0;
        this._titleSignalId = 0;
        this._focusReturnedTo = null;
        this._keyboardRow = null;
        this._highlightId = 0;
        this._eventFilterId = 0;
        this._swallowedPress = null;
        this._replayId = 0;
        this._replayPointer = null;
        this._stockSignals = [];
        this._toggleMenu = null;
        this._stockBox = null;
        this._shellWatches = [];
        this._scroll = null;
        this._scrollCapId = 0;
        this._monitorsSignalId = 0;
        this._quickSettingsBox = null;
        this._boxHeightSignalId = 0;

        this._settingsSignals = [
            ...LAYOUT_KEYS.map(key =>
                settings.connect(`changed::${key}`, () => this.queueUpdateLayout())),
            settings.connect('changed::qs-menu-style', () => this._closeMenus()),
            settings.connect('changed::qs-visible-rows', () => this._queueScrollCap()),
            settings.connect('changed::show-on-all-monitors', () => this._syncCopies()),
        ];

        this._attach();
    }

    addIcon(id, actor) {
        this._icons.set(id, actor);
        this.queueUpdateLayout();
    }

    removeIcon(id) {
        this._icons.delete(id);
        this._dropTrayRow(id);
        this.queueUpdateLayout();
    }

    _handleIconClick(actor) {
        if (!keepsOverflowOpen(this._settings)) {
            this._quickSettings.menu.close();
            return;
        }
        if (!this._section.box.contains(actor))
            return;

        // Raising a window can fold the menu or close Quick Settings as a whole
        debounceTo(this, '_reopenId', 0, () => {
            if (!keepsOverflowOpen(this._settings))
                return;
            const quickSettings = this._quickSettings.menu;
            if (!quickSettings.isOpen)
                quickSettings.open();
            this._toggle.menu.open();
        });
    }

    _onAnyDragBegin() {}

    _onAnyDragEnd() {}

    queueUpdateLayout() {
        debounceTo(this, '_layoutUpdateId', LAYOUT_UPDATE_DELAY_MS, () => this._updateRows());
    }

    _attach() {
        this._copiesChangedId = connectPanelCopies(() => this._syncCopies());
        this._syncCopies();
    }

    // Only one Quick Settings can be open at a time, so the block of rows
    // lives in one and moves into whichever opens. Every other copy gets the
    // visibility override and a watch on its menu.
    _syncCopies() {
        const {found, isComplete} = backgroundAppsToggles(this._settings);
        const wanted = new Set(found.map(({toggle}) => toggle));
        for (const toggle of [...this._attachments.keys()]) {
            if (!wanted.has(toggle))
                this._detach(toggle);
        }
        found.forEach(({copy, toggle}) => this._attachTo(copy, toggle));

        if (this._toggle && !this._attachments.has(this._toggle))
            this._leaveToggle();
        const [first] = this._attachments.keys();
        if (!this._toggle && first)
            this._adopt(first);

        if (!isComplete)
            this._awaitToggles();
    }

    _awaitToggles() {
        if (this._findToggleId)
            return;
        const deadline = GLib.get_monotonic_time() + BACKGROUND_TOGGLE_WAIT_MS * GLib.TIME_SPAN_MILLISECOND;
        this._findToggleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const {isComplete} = backgroundAppsToggles(this._settings);
            if (!isComplete && GLib.get_monotonic_time() <= deadline)
                return GLib.SOURCE_CONTINUE;
            this._findToggleId = 0;
            this._syncCopies();
            return GLib.SOURCE_REMOVE;
        });
    }

    _attachTo(copy, toggle) {
        if (this._attachments.has(toggle))
            return;
        // An override an earlier host left behind is never the original
        if (toggle._syncVisibility[SYNC_OVERRIDE_MARK])
            delete toggle._syncVisibility;
        const quickSettings = copy.quickSettings;
        this._attachments.set(toggle, {
            quickSettings,
            menuManager: copy.menuManager,
            original: toggle._syncVisibility,
            // The shell defines this on the class, an own copy would shadow
            // whatever a later shell puts on the prototype.
            hadOwnSync: Object.hasOwn(toggle, '_syncVisibility'),
            disposeId: watchDisposal(toggle),
            openSignalId: quickSettings.menu.connect('open-state-changed',
                (_menu, isOpen) => this._onQuickSettingsOpen(toggle, isOpen)),
        });

        // The shell hides the item whenever the portal lists nothing, and
        // calls this again on every portal and session mode change.
        const override = () => {
            toggle.visible = !Main.sessionMode.isLocked &&
                (toggle.menu.isOpen || this._shownCount > 0);
        };
        override[SYNC_OVERRIDE_MARK] = true;
        toggle._syncVisibility = override;
        toggle._syncVisibility();
        if (quickSettings.menu.isOpen)
            this._onQuickSettingsOpen(toggle, true);
    }

    // A menu left open would come back with Quick Settings, half stale
    _onQuickSettingsOpen(toggle, isOpen) {
        if (isOpen) {
            if (toggle !== this._toggle) {
                this._leaveToggle();
                this._adopt(toggle);
            }
            this._addEventFilter();
            return;
        }
        if (toggle !== this._toggle)
            return;
        debounceTo(this, '_closeMenusId', 0, () => {
            this._closeMenus();
            this._removeEventFilter();
        });
    }

    _detach(toggle) {
        const {quickSettings, original, hadOwnSync, disposeId, openSignalId} = this._attachments.get(toggle);
        this._attachments.delete(toggle);
        quickSettings.menu.disconnect(openSignalId);
        if (isDisposed(toggle))
            return;
        toggle.disconnect(disposeId);
        if (hadOwnSync)
            toggle._syncVisibility = original;
        else
            delete toggle._syncVisibility;
        toggle._syncVisibility();
    }

    _leaveToggle() {
        this._dropRows();
        this._restoreToggle();
    }

    _adopt(toggle) {
        this._toggle = toggle;
        this._quickSettings = this._attachments.get(toggle).quickSettings;
        this._section = new PopupMenu.PopupMenuSection();
        toggle.menu.addMenuItem(this._section, 0);

        // Quick Settings never scrolls and runs off the screen instead, so the
        // list scrolls inside the menu past the row cap or the screen's end
        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
        });
        toggle.menu.box.replace_child(this._section.actor, this._scroll);
        this._scroll.set_child(this._section.actor);
        overlayScrollbar(this._scroll, toggle.menu.box);
        // The menu finds its sections through its children's delegates
        this._scroll._delegate = this._section;

        // Last in the menu, so right below the shell's own App Settings
        this._prefsItem = new PopupMenu.PopupMenuItem(_('Open BTI Settings'));
        this._prefsItem.connect('activate', () => {
            Main.overview.hide();
            this._quickSettings.menu.close();
            this._openPreferences();
        });
        toggle.menu.addMenuItem(this._prefsItem);

        // At logout the shell takes its toggle and menu down before BTI is
        // disabled, so the teardown runs early and skips what is gone
        this._toggleMenu = toggle.menu;
        this._stockBox = toggle._appsSection.box;
        const onShellDestroyed = () => this._onShellDestroyed();
        this._shellWatches = [
            [toggle, watchDisposal(toggle, onShellDestroyed)],
            [toggle.menu.actor, watchDisposal(toggle.menu.actor)],
            [this._stockBox, watchDisposal(this._stockBox)],
            [this._section.actor, watchDisposal(this._section.actor, onShellDestroyed)],
            [this._prefsItem, watchDisposal(this._prefsItem)],
            [this._scroll, watchDisposal(this._scroll)],
        ];

        // The shell rebuilds its rows from scratch on every portal change and
        // writes its own title right after, so the merge waits for that.
        const stockBox = this._stockBox;
        this._stockSignals.push(
            stockBox.connect('child-added', () => this._queueMerge()),
            stockBox.connect('child-removed', () => this._queueMerge()));

        // An empty portal list changes no row, the shell's own title is then
        // the only sign of its sync
        this._titleSignalId = toggle.connect('notify::title', () => {
            if (toggle.title !== backgroundAppsTitle(this._shownCount))
                this._queueMerge();
        });

        // Before the menu has ever been shown its rows report a natural width
        // without their theme, a slot sized then cuts the icons off
        this._menuSignalId = toggle.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                return;
            alignIconSlots(this._rowsInOrder(), this._iconSizePx());
            this._queueScrollCap();
        });
        this._monitorsSignalId = Main.layoutManager.connect('monitors-changed', () => this._queueScrollCap());
        // The room is what Quick Settings leaves, and its box only follows the
        // menu's eased height a frame later through a bind constraint
        this._quickSettingsBox = this._quickSettings.menu.box;
        this._boxHeightSignalId = this._quickSettingsBox.connect('notify::height', () => this._queueScrollCap());

        // A menu's grab swallows the pointer's crossings, and closing it hands
        // the focus back to the row it opened from. Both leave a row lit that
        // the pointer has long left. Keyboard moves stay as they are.
        this._keyFocusSignalId = global.stage.connect('notify::key-focus', () => {
            // The opener taking the focus back after a keyboard close is meant
            const isReturn = global.stage.get_key_focus() === this._focusReturnedTo;
            this._focusReturnedTo = null;
            const isKeyMove = isKeyEvent(Clutter.get_current_event());
            // A hover moves the focus too, and must not scroll the list
            const focus = global.stage.get_key_focus();
            if ((isKeyMove || isReturn) && focus && this._section.box.contains(focus))
                scrollIntoView(this._scroll, focus);
            if (!isReturn && !isKeyMove)
                debounceTo(this, '_highlightId', 0, () => this._syncRowHighlight());
        });

        this._updateRows();
    }

    _updateRows() {
        if (!this._section)
            return;

        const entries = this._visibleEntries();
        const shownIds = new Set(entries.map(entry => entry.id));
        for (const id of [...this._trayRows.keys()]) {
            if (!shownIds.has(id))
                this._dropTrayRow(id);
        }

        for (const {id, actor} of entries) {
            if (!this._trayRows.has(id))
                this._trayRows.set(id, this._createTrayRow(actor));
        }
        this._trayOrder = entries.map(entry => this._trayRows.get(entry.id));

        this._mergeStockRows();
    }

    _visibleEntries() {
        const configMap = getAppConfigMap(this._settings);
        const isWineEnabled = this._settings.get_boolean('enable-wine-support');

        const entries = [];
        for (const [id, actor] of this._icons) {
            if (isDisposed(actor))
                continue;
            const config = (actor._appId && configMap[actor._appId]) || null;
            const isHidden = config?.is_hidden ||
                (actor._isXembed && !isWineEnabled) ||
                actor._isPassive;
            if (!isHidden)
                entries.push({id, actor, appId: actor._appId, priority: config?.priority || 0});
        }
        return entries.sort(byPriorityThenAppId);
    }

    _createTrayRow(actor) {
        const openMenu = event => this._openMenu(row, {
            popup: () => actor._trayAction('menu', event),
            fill: menu => actor._trayFillMenu(menu),
        });
        const row = new BackgroundAppRow({
            iconActor: actor,
            appId: actor._appId,
            title: actor._trayTitle,
            settings: this._settings,
            onAction: (action, event) => {
                if (action === 'menu')
                    openMenu(event);
                else if (!IGNORED_ACTIONS.has(action))
                    actor._trayAction(action, event);
            },
        });
        actor._trayTitleChanged = () => row.setTitle(actor._trayTitle);
        actor._trayRowSlot = row.iconSlot;
        actor._trayRestyle();
        actor._trayGrabManagers = () => [this._attachments.get(this._toggle).menuManager, this._toggle._menuManager];
        // The icon keeps its own scroll handling, the row only hands it on
        row.connect('scroll-event', (_row, event) => actor.emit('scroll-event', event));
        this._bindDrag(row);
        this._section.addMenuItem(row);
        return row;
    }

    _queueMerge() {
        if (this._mergeId)
            return;
        this._mergeId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._mergeId = 0;
            this._mergeStockRows();
            return GLib.SOURCE_REMOVE;
        });
    }

    // A tray item outranks the portal's entry for the same app. Every row then
    // takes its place by the stored priority, unranked portal apps keep the
    // shell's own order at the end.
    _mergeStockRows() {
        const toggle = this._toggle;
        const trayAppIds = new Set(this._trayOrder.map(row => row.appId));
        const listed = new Set();
        const portalOrder = [];
        for (const stockRow of stockRowsOf(toggle)) {
            stockRow.visible = false;
            const appId = stockAppId(stockRow);
            if (trayAppIds.has(appId) || listed.has(appId))
                continue;
            listed.add(appId);

            let row = this._portalRows.get(appId);
            if (!row) {
                row = this._createPortalRow(appId, stockRow.app);
                this._portalRows.set(appId, row);
            }
            row.setMessage(stockRow.message);
            this._portalIcons.get(appId).setMessage(stockRow.message);
            portalOrder.push(row);
        }
        for (const [appId, row] of [...this._portalRows]) {
            if (!portalOrder.includes(row))
                this._dropPortalRow(appId);
        }

        const configMap = getAppConfigMap(this._settings);
        const priorityOf = row => configMap[row.appId]?.priority || 0;
        const rows = [...this._trayOrder, ...portalOrder]
            .sort((a, b) => priorityOf(b) - priorityOf(a));
        if (!this._drag)
            this._arrange(rows);
        alignIconSlots(rows, this._iconSizePx());
        this._queueScrollCap();

        toggle._listTitle.visible = false;
        this._shownCount = this._trayOrder.length + portalOrder.length;
        toggle.title = backgroundAppsTitle(this._shownCount);
        // The tile shows on every monitor's Quick Settings, not just this one
        for (const attached of this._attachments.keys())
            attached._syncVisibility();
    }

    // An app without a tray item gets the proxy icon the panel would show for
    // it, its row then looks and acts like any tray item's
    _createPortalRow(appId, app) {
        const entry = {app, flatpakId: app.get_id().replace(DESKTOP_SUFFIX_RE, ''), message: null};
        const icon = new BackgroundAppsProxyIcon(appId, entry, this._settings, {
            onAfterClick: actor => {
                Main.overview.hide();
                this._handleIconClick(actor);
            },
            onDragStateChange: forwardDragStateToIndicator(this),
        });
        this._portalIcons.set(appId, icon);
        return this._createTrayRow(icon.actor);
    }

    // An open inline menu sits right below its row
    _arrange(rows) {
        const box = this._section.box;
        let index = 0;
        for (const row of rows) {
            moveActorToIndex(row, box, index++);
            if (this._inline?.row === row)
                moveActorToIndex(this._inline.menu.actor, box, index++);
        }
    }

    // Only the row under the pointer stays lit, or none
    _syncRowHighlight() {
        // An open row menu owns the focus, every row menu goes through this manager
        const isRowMenuOpen = menuManagerFor(this._section.box, this._settings).activeMenu;
        if (!this._toggle.menu.isOpen || this._drag || isRowMenuOpen)
            return;
        // A pick sees past the grab, the rows' own hover tracking does not
        const [x, y] = global.get_pointer();
        const pointed = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        const rows = this._rowsInOrder();
        const hovered = rows.find(row => row.contains(pointed));
        rows.forEach(row => (row.hover = row === hovered));
        const focused = rows.find(row => row.has_key_focus());
        // A row the keyboard just went back to stays focused until the
        // pointer points at a row again
        if (!hovered && focused && focused === this._keyboardRow)
            return;
        this._keyboardRow = null;
        if (hovered && hovered !== focused)
            hovered.grab_key_focus();
        else if (!hovered && focused)
            this._toggle.menu.actor.grab_key_focus();
    }

    _iconSizePx() {
        return this._settings.get_int('icon-size') * St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    _openMenu(row, {popup, fill}) {
        const wasOpen = this._inline?.row === row;
        this._closeMenus();
        if (wasOpen)
            return;

        if (this._settings.get_string('qs-menu-style') === 'inline')
            this._openInline(row, popup, fill).catch(logError);
        else
            popup();
    }

    // The shell's own submenu, unparented so it is its own top menu. Nested
    // submenus then fold only their siblings, and a click in it closes it
    // rather than the shell's Background Apps menu.
    async _openInline(row, popup, fill) {
        const menu = new PopupMenu.PopupSubMenu(row.iconActor, row.menuArrow);
        overlayScrollbar(menu.actor);
        this._section.box.insert_child_above(menu.actor, row);
        const inline = {row, menu, returnsFocus: false};
        this._inline = inline;
        // Marked open the way the shell marks its expander, the theme then
        // rounds only the top. The look stays until the fold has finished.
        menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                row.setHeaderOpen(true, menu);
                return;
            }
            // Still before the grab hands the focus back to wherever it was
            const focus = global.stage.get_key_focus();
            const isKeyClose = isKeyEvent(Clutter.get_current_event());
            inline.returnsFocus = isKeyClose || (focus !== null && menu.actor.contains(focus));
        });
        // In place before the manager's own Escape handling, which would fold
        // the whole list. 51 handles keys in a capture phase key controller,
        // 49 and 50 in a captured-event handler.
        if (Clutter.KeyController) {
            const keys = new Clutter.KeyController();
            keys.connect('key-press', () => foldDeepestOnEscape(menu, keys.get_key()[1]));
            menu.actor.add_action_full(ESCAPE_FOLD_ACTION, Clutter.EventPhase.CAPTURE, keys);
        } else {
            menu.actor.connect('captured-event', (_actor, event) => {
                const isKeyPress = event.type() === Clutter.EventType.KEY_PRESS;
                return isKeyPress ? foldDeepestOnEscape(menu, event.get_key_symbol()) : Clutter.EVENT_PROPAGATE;
            });
        }
        // Dropped once folded, a destroy inside the close would cut its animation
        menu.actor.connect('hide', () => {
            row.setHeaderOpen(false);
            if (this._inline?.menu !== menu)
                return;
            // The rows below only settle once the fold is done
            debounceTo(this, '_inlineDropId', 0, () => {
                this._closeInline();
                // A keyboard close keeps the focus on the opener, not the pointer
                if (!inline.returnsFocus)
                    this._syncRowHighlight();
            });
        });

        // A menu we cannot build, a Wine one included, is the app's own to show
        const isFilled = await Promise.resolve(fill(menu)).catch(() => false);
        if (this._inline?.menu !== menu)
            return;
        if (!isFilled) {
            this._closeInline();
            popup();
            return;
        }
        // Each Quick Settings item grabs for its own menu and takes Escape
        // there, so the submenu needs a grab of its own to close first.
        menuManagerFor(row.iconActor, this._settings).addMenu(menu);
        menu.actor.connect('captured-event', (_view, event) => this._onInlineEvent(menu.actor, event));
        menu.actor.connect('notify::height', () => this._queueScrollCap());
        // An opened nested submenu changes only the content, the pinned view keeps its height
        menu.box.connect('queue-relayout', () => this._queueScrollCap());
        // Capped before it unfolds, the fold would otherwise run to the full height
        this._syncScrollCap();
        menu.open(POPUP_ANIMATION_FULL);
        menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
    }

    // The wheel moves the inline menu until it hits an end, from there the
    // list around it takes over. Captured, because an open nested submenu is
    // a scroll view of its own and would keep the wheel at the boundary.
    _onInlineEvent(view, event) {
        if (event.type() !== Clutter.EventType.SCROLL)
            return Clutter.EVENT_PROPAGATE;
        // The menu's grab sends it every wheel event, a pick sees past that
        const [x, y] = event.get_coords();
        const isOverMenu = view.contains(global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y));
        const step = scrollStep(event);
        const {value, lower, upper, page_size: pageSize} = view.vadjustment;
        const isAtTop = step < 0 && value <= lower;
        const isAtEnd = step > 0 && value >= upper - pageSize;
        if (!isOverMenu || step === 0 || isAtTop || isAtEnd)
            this._scroll.emit('scroll-event', event);
        else
            view.vadjustment.adjust_for_scroll_event(step);
        return Clutter.EVENT_STOP;
    }

    _closeInline() {
        const inline = this._inline;
        if (!inline)
            return;
        this._inline = null;
        inline.row.setHeaderOpen(false);
        const focus = global.stage.get_key_focus();
        const hasFocus = focus !== null && inline.menu.actor.contains(focus);
        inline.menu.destroy();
        if (hasFocus || inline.returnsFocus) {
            this._focusReturnedTo = inline.row;
            this._keyboardRow = inline.row;
            inline.row.grab_key_focus();
        }
    }

    // Only while Quick Settings is open or a swallowed press waits for its
    // release, every other event then pays nothing. No stage given, a filter
    // bound to one asks every event for its actor and device events have none.
    _addEventFilter() {
        this._eventFilterId ||= Clutter.Event.add_filter(null, event => this._onStageEvent(event));
    }

    _removeEventFilter() {
        const isNeeded = this._swallowedPress || this._quickSettings?.menu.isOpen;
        if (!isNeeded)
            clearIds(this, Clutter.Event.remove_filter, '_eventFilterId');
    }

    // Each open layer holds a grab, so an outside click would only close one.
    // The press is swallowed and replayed as a whole click once Quick Settings is
    // gone and the button is up, a client ignores a press the seat still holds.
    _onStageEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            const swallowed = this._swallowedPress;
            const isSwallowed = swallowed && event.get_button() === swallowed.button &&
                event.get_source_device() === swallowed.device;
            return isSwallowed ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
        if (type !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;
        // A swallowed press lives until its replay at the latest, a release
        // that never reached this filter cannot eat a later one
        this._dropSwallowedPress();
        try {
            return this._takeOutsidePress(event);
        } catch (e) {
            warnOnce('outside-click', `Outside click left to the shell: ${e.message}`);
            this._dropSwallowedPress();
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _takeOutsidePress(event) {
        const [x, y] = event.get_coords();
        const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        if (!this._isOutsideClick(target))
            return Clutter.EVENT_PROPAGATE;

        const button = event.get_button();
        this._closeMenus();
        this._quickSettings.menu.close();
        // A replayed press on the indicator would open Quick Settings again
        if (this._quickSettings.contains(target))
            return Clutter.EVENT_STOP;
        // Mutter hands the release to the app under the pointer before any
        // filter of ours runs, unless the stage holds a grab (core/events.c).
        // The grab stays until the replay, so the app sees only that.
        this._swallowedPress = {button, device: event.get_source_device(), grab: global.stage.grab(global.stage)};
        clearIds(this, removeTimer, '_reopenId');
        this._awaitButtonUp(button, x, y);
        return Clutter.EVENT_STOP;
    }

    // Only while the Background Apps menu or a row menu is open, a bare Quick
    // Settings keeps the shell's own behaviour. The panel counts as outside,
    // the open menu's grab would take the press from its buttons too.
    _isOutsideClick(target) {
        const quickSettings = this._quickSettings.menu;
        const isRowMenuOpen = menuManagerFor(this._section.box, this._settings).activeMenu;
        const isAnyMenuOpen = this._toggle.menu.isOpen || isRowMenuOpen;
        if (!quickSettings.isOpen || !isAnyMenuOpen)
            return false;
        return !openMenuActors(quickSettings, this._toggle).some(actor => actor.contains(target));
    }

    _awaitButtonUp(button, x, y) {
        const heldMask = Clutter.ModifierType.BUTTON1_MASK << (button - 1);
        const deadline = GLib.get_monotonic_time() + REPLAY_WAIT_MS * GLib.TIME_SPAN_MILLISECOND;
        clearIds(this, removeTimer, '_replayId');
        this._replayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REPLAY_POLL_MS, () => {
            const [, , mods] = global.get_pointer();
            const isHeld = (mods & heldMask) !== 0;
            if (isHeld && GLib.get_monotonic_time() < deadline)
                return GLib.SOURCE_CONTINUE;
            this._replayId = 0;
            this._dropSwallowedPress();
            this._replayClick(button, x, y);
            this._removeEventFilter();
            return GLib.SOURCE_REMOVE;
        });
    }

    _dropSwallowedPress() {
        this._swallowedPress?.grab.dismiss();
        this._swallowedPress = null;
    }

    _replayClick(button, x, y) {
        // Clutter.get_default_backend() is gone in 51, the stage's context
        // carries the backend on 49 to 51 (clutter_context_get_backend)
        this._replayPointer ??= global.stage.context.get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const pointer = this._replayPointer;
        const now = GLib.get_monotonic_time();
        // Mutter repicks the surface under the pointer on motion and crossings
        // only, and the pointer has not moved since the grab hid that surface
        pointer.notify_absolute_motion(now, x + REPICK_NUDGE_PX, y);
        pointer.notify_absolute_motion(now, x, y);
        pointer.notify_button(now, button, Clutter.ButtonState.PRESSED);
        pointer.notify_button(now, button, Clutter.ButtonState.RELEASED);
    }

    _closeMenus() {
        this._closeInline();
    }

    // Same as the panel, press anywhere and move past the drag threshold,
    // and only when a long press is bound to drag and drop. The grab keeps
    // Quick Settings and its menu open around the move.
    _bindDrag(row) {
        row.connect('button-press-event', (_row, event) => this._onRowPress(row, event));
        row.connect('motion-event', (_row, event) => this._onRowMotion(row, event));
        row.connect('button-release-event', () => this._onRowRelease());
        row.connect('key-press-event', (_row, event) => this._onDragKey(event));
    }

    _onRowPress(row, event) {
        const isDragButton = event.get_button() === Clutter.BUTTON_PRIMARY;
        if (!this._drag && isDragButton && isDragEnabledFromSettings(this._settings))
            this._press = {row, startY: event.get_coords()[1]};
        return Clutter.EVENT_PROPAGATE;
    }

    _onRowMotion(row, event) {
        const [, y] = event.get_coords();
        if (!this._drag) {
            const press = this._press;
            if (press?.row !== row || Math.abs(y - press.startY) < dragThreshold())
                return Clutter.EVENT_PROPAGATE;
            this._press = null;
            this._beginMove(row, press.startY);
        }

        const drag = this._drag;
        scrollAtEdge(this._scroll, y);
        drag.clone.y = y - drag.offsetY;
        const others = this._rowsInOrder().filter(other => other !== drag.row);
        const index = others.filter(other => rowCenterY(other) < y).length;
        moveActorToIndex(drag.row, this._section.box, index);
        return Clutter.EVENT_STOP;
    }

    _onRowRelease() {
        this._press = null;
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        return this._finishDrag(true);
    }

    _beginMove(row, startY) {
        this._closeMenus();
        const [x, top] = row.get_transformed_position();
        const drag = {row, order: this._rowsInOrder(), offsetY: startY - top, grab: global.stage.grab(row)};
        this._drag = drag;
        // The row paints no surface of its own, without the menu's the rows
        // under the clone would show through it.
        const {width, height} = drag.row;
        drag.clone = new St.Bin({
            style_class: 'quick-toggle-menu',
            style: DRAG_CLONE_CSS,
            x,
            y: top,
            child: new Clutter.Clone({source: drag.row, width, height}),
        });
        Main.layoutManager.uiGroup.add_child(drag.clone);
        drag.row.setDragged(true);
    }

    _onDragKey(event) {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        if (event.get_key_symbol() === Clutter.KEY_Escape)
            this._finishDrag(false);
        return Clutter.EVENT_STOP;
    }

    _finishDrag(isDrop) {
        const drag = this._drag;
        this._drag = null;
        drag.grab.dismiss();
        drag.clone.destroy();
        drag.row.setDragged(false);
        if (isDrop)
            this._storeOrder(drag.row);
        else
            drag.order.forEach((row, index) => moveActorToIndex(row, this._section.box, index));
        return Clutter.EVENT_STOP;
    }

    // Rows sharing an appId share one priority, so only the dropped one of
    // them speaks for the app, same as the panel drop.
    _storeOrder(dropped) {
        const order = this._rowsInOrder()
            .filter(row => row === dropped || row.appId !== dropped.appId)
            .map(row => row.appId);
        setAppPriorities(this._settings, order);
    }

    // Sized once the menu is laid out, before that neither the rows nor
    // Quick Settings report their real heights
    _queueScrollCap() {
        if (this._scrollCapId)
            return;
        this._scrollCapId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._scrollCapId = 0;
            this._syncScrollCap();
            return GLib.SOURCE_REMOVE;
        });
    }

    // The list stops at the configured row count and at the bottom of the
    // work area, an open inline menu then scrolls inside what is left of it
    _syncScrollCap() {
        const scroll = this._scroll;
        if (!scroll)
            return;
        const viewHeight = Math.min(this._rowCapHeight(), quickSettingsRoom(scroll, scroll.height));
        const [, contentHeight] = this._section.actor.get_preferred_height(-1);
        capScrollView(scroll, contentHeight, viewHeight);

        const inline = this._inline;
        if (!inline)
            return;
        pinOpenSubMenus(inline.menu);
        const [, menuHeight] = inline.menu.box.get_preferred_height(-1);
        capScrollView(inline.menu.actor, menuHeight, viewHeight - inline.row.height);
    }

    // Real row heights, so the visible part ends on a row's edge even with
    // the taller two-line portal rows
    _rowCapHeight() {
        const rows = this._rowsInOrder().filter(row => row.visible);
        const cap = this._settings.get_int('qs-visible-rows');
        if (rows.length <= cap)
            return Infinity;
        const spacing = this._section.box.get_theme_node().get_length('spacing');
        const forWidth = this._section.box.has_allocation() ? this._section.box.width : -1;
        return rows.slice(0, cap).reduce((sum, row, index) => {
            const rowHeight = row.has_allocation() ? row.height : row.get_preferred_height(forWidth)[1];
            return sum + rowHeight + (index > 0 ? spacing : 0);
        }, 0);
    }

    _rowsInOrder() {
        return this._section.box.get_children().filter(child => child instanceof BackgroundAppRow);
    }

    _dropTrayRow(id) {
        const row = this._trayRows.get(id);
        if (!row)
            return;
        this._trayRows.delete(id);
        this._trayOrder = this._trayOrder.filter(other => other !== row);
        this._dropRow(row);
    }

    _dropPortalRow(appId) {
        const row = this._portalRows.get(appId);
        this._portalRows.delete(appId);
        this._dropRow(row);
        this._portalIcons.get(appId).destroy();
        this._portalIcons.delete(appId);
    }

    _dropRow(row) {
        if (this._drag?.row === row)
            this._finishDrag(false);
        if (this._inline?.row === row)
            this._closeInline();
        row.releaseIcon();
        // The section forgets a destroyed row, the menu above it keeps it as
        // its active item and touches it on the next hover
        row.active = false;
        row.destroy();
    }

    // The icons belong to BTI and leave the rows before the shell's destroy
    // reaches them, the rows themselves go down with the shell's menu
    _onShellDestroyed() {
        if (!this._toggle)
            return;
        clearIds(this, removeTimer, '_mergeId', '_reopenId', '_closeMenusId', '_highlightId', '_inlineDropId');
        this._inline = null;
        this._drag = null;
        for (const row of [...this._trayRows.values(), ...this._portalRows.values()])
            row.releaseIcon();
        this._trayRows.clear();
        this._trayOrder = [];
        this._portalRows.clear();
        this._portalIcons.forEach(icon => icon.destroy());
        this._portalIcons.clear();
        this._detach(this._toggle);
        this._restoreToggle();
    }

    destroy() {
        // First, so no later teardown step that throws can keep an override
        for (const toggle of [...this._attachments.keys()])
            this._detach(toggle);
        clearIds(this, removeTimer, '_layoutUpdateId', '_findToggleId', '_mergeId', '_reopenId', '_inlineDropId', '_closeMenusId', '_highlightId', '_replayId');
        clearIds(this, disconnectPanelCopies, '_copiesChangedId');
        disconnectAll(this, this._settings, '_settingsSignals');
        this._dropRows();
        this._icons.clear();
        this._restoreToggle();
    }

    _dropRows() {
        if (this._drag)
            this._finishDrag(false);
        this._closeMenus();
        for (const id of [...this._trayRows.keys()])
            this._dropTrayRow(id);
        for (const appId of [...this._portalRows.keys()])
            this._dropPortalRow(appId);
    }

    _restoreToggle() {
        const toggle = this._toggle;
        if (!toggle)
            return;
        this._toggle = null;
        this._quickSettings = null;

        disconnectSignal(this, global.stage, '_keyFocusSignalId');
        disconnectSignal(this, Main.layoutManager, '_monitorsSignalId');
        clearIds(this, id => global.compositor.get_laters().remove(id), '_scrollCapId');
        this._dropSwallowedPress();
        clearIds(this, Clutter.Event.remove_filter, '_eventFilterId');
        this._replayPointer = null;

        const isAlive = actor => !isDisposed(actor);
        const menu = this._toggleMenu;
        const stockBox = this._stockBox;
        const quickSettingsBox = this._quickSettingsBox;
        this._toggleMenu = null;
        this._stockBox = null;
        this._quickSettingsBox = null;
        for (const [actor, id] of this._shellWatches.filter(([watched]) => isAlive(watched)))
            actor.disconnect(id);
        this._shellWatches = [];

        if (isAlive(stockBox))
            disconnectAll(this, stockBox, '_stockSignals');
        this._stockSignals = [];
        if (isAlive(menu.actor))
            disconnectSignal(this, menu, '_menuSignalId');
        this._menuSignalId = 0;
        if (isAlive(quickSettingsBox))
            disconnectSignal(this, quickSettingsBox, '_boxHeightSignalId');
        this._boxHeightSignalId = 0;
        if (isAlive(toggle))
            disconnectSignal(this, toggle, '_titleSignalId');
        this._titleSignalId = 0;
        if (isAlive(this._section.actor))
            this._section.destroy();
        this._section = null;
        if (isAlive(this._scroll))
            this._scroll.destroy();
        this._scroll = null;
        if (isAlive(this._prefsItem))
            this._prefsItem.destroy();
        this._prefsItem = null;
        if (!isAlive(toggle) || !isAlive(stockBox))
            return;

        const stockRows = stockRowsOf(toggle);
        stockRows.forEach(stockRow => (stockRow.visible = true));
        toggle._listTitle.visible = stockRows.length > 0;
        toggle.title = backgroundAppsTitle(stockRows.length);

        toggle._syncVisibility();
    }
}

function stockRowsOf(toggle) {
    return toggle._appsSection.box.get_children().filter(child => child.app);
}

// Tray icons carry their own padding and portal icons none, one slot width
// keeps every icon and title in a column. A slot sized before its icon has a
// size takes the configured one, a 0 px slot would squeeze the icon away.
function alignIconSlots(rows, iconSize) {
    for (const row of rows)
        row.iconSlot.width = -1;
    const width = Math.max(...rows.map(row =>
        Math.max(row.iconSlot.get_preferred_width(-1)[1], iconSize + horizontalChrome(row.iconActor))));
    for (const row of rows)
        row.iconSlot.width = width;
}

function foldDeepestOnEscape(menu, symbol) {
    const deepest = symbol === Clutter.KEY_Escape ? deepestOpenSubmenuItem(menu) : null;
    if (!deepest)
        return Clutter.EVENT_PROPAGATE;
    // The fold hands the focus on when it ends, so the header takes it after
    const hideId = deepest.menu.actor.connect('hide', () => {
        deepest.menu.actor.disconnect(hideId);
        deepest.grab_key_focus();
    });
    deepest.setSubmenuShown(false);
    return Clutter.EVENT_STOP;
}

function deepestOpenSubmenuItem(menu) {
    for (const child of menu.box.get_children()) {
        if (child instanceof PopupMenu.PopupSubMenuMenuItem && child.menu.isOpen)
            return deepestOpenSubmenuItem(child.menu) ?? child;
    }
    return null;
}

// Quick Settings itself, the Background Apps menu and every open popup on the
// layer, a row's side menu and a flyout included
function openMenuActors(quickSettings, toggle) {
    const popups = Main.layoutManager.uiGroup.get_children()
        .filter(actor => actor._delegate?.isOpen && actor._delegate.box);
    return [quickSettings.actor, toggle.menu.actor, ...popups];
}

function horizontalChrome(actor) {
    const node = actor.get_theme_node();
    return node.get_horizontal_padding() +
        node.get_border_width(St.Side.LEFT) + node.get_border_width(St.Side.RIGHT) +
        node.get_margin(St.Side.LEFT) + node.get_margin(St.Side.RIGHT);
}

// A scrolling list lays its children out at their minimum height, which for a
// scroll view is just its scrollbar, so the cap pins both ends. The cap
// counts the view's padding, CSS heights leave it out.
function capScrollView(view, contentHeight, maxHeight) {
    const node = view.get_theme_node();
    const chrome = node.get_vertical_padding() +
        node.get_border_width(St.Side.TOP) + node.get_border_width(St.Side.BOTTOM);
    const isScrolling = contentHeight + chrome > maxHeight;
    const height = Math.max(0, Math.floor(maxHeight - chrome));
    view.vscrollbar_policy = isScrolling ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER;
    setStylePart(view, 'cap', isScrolling ? `min-height: ${height}px; max-height: ${height}px;` : null);
}

// Same squeeze one level down, a scrolling menu lays out its open submenus at
// their scrollbar's height too. They keep their full height and the menu
// around them scrolls instead. The shell's own fold sizes them while it runs
// and drops the pin once a submenu is folded.
function pinOpenSubMenus(menu) {
    for (const item of menu._getMenuItems()) {
        if (!item.menu?.isOpen)
            continue;
        pinOpenSubMenus(item.menu);
        const view = item.menu.actor;
        if (view.get_transition('height'))
            continue;
        // Measured on the content, the pinned view would report the pin.
        // Natural is pinned along, Clutter aborts on any width where the
        // natural height comes out below the minimum.
        const node = view.get_theme_node();
        const forWidth = view.has_allocation() ? node.get_content_box(view.get_allocation_box()).get_width() : -1;
        const [, contentHeight] = view.child.get_preferred_height(forWidth);
        const [, height] = node.adjust_preferred_height(contentHeight, contentHeight);
        // Only on a change, every pin queues a relayout and that syncs again
        if (!view.min_height_set || view.min_height !== height)
            view.set_height(height);
    }
}

// A wheel notch arrives as a discrete event plus an emulated smooth one,
// St scrolls on the discrete one only
function scrollStep(event) {
    if (event.get_flags() & Clutter.EventFlags.POINTER_EMULATED)
        return 0;
    switch (event.get_scroll_direction()) {
    case Clutter.ScrollDirection.UP:
        return -1;
    case Clutter.ScrollDirection.DOWN:
        return 1;
    case Clutter.ScrollDirection.SMOOTH:
        return event.get_scroll_delta()[1];
    default:
        return 0;
    }
}

function scrollIntoView(scroll, actor) {
    const [, top] = actor.get_transformed_position();
    const [, viewTop] = scroll.get_transformed_position();
    const offset = top - viewTop;
    const overflow = offset + actor.height - scroll.height;
    if (offset < 0)
        scroll.vadjustment.value += offset;
    else if (overflow > 0)
        scroll.vadjustment.value += overflow;
}

function scrollAtEdge(scroll, pointerY) {
    const [, viewTop] = scroll.get_transformed_position();
    if (pointerY < viewTop + DRAG_SCROLL_EDGE_PX)
        scroll.vadjustment.value -= DRAG_SCROLL_STEP_PX;
    else if (pointerY > viewTop + scroll.height - DRAG_SCROLL_EDGE_PX)
        scroll.vadjustment.value += DRAG_SCROLL_STEP_PX;
}

function rowCenterY(row) {
    const [, top] = row.get_transformed_position();
    return top + row.height / 2;
}

// The portal names flatpaks only, so the id takes the same shape the tray
// item got from its own packaging.
function stockAppId(stockRow) {
    const flatpakId = stockRow.app.get_id().replace(DESKTOP_SUFFIX_RE, '');
    return pickAppId({packaging: {kind: 'flatpak', id: flatpakId}});
}

function backgroundAppsTitle(count) {
    if (count === 0)
        return Gettext.dgettext(SHELL_DOMAIN, 'No Background Apps');
    return Gettext.dngettext(SHELL_DOMAIN, '%d Background App', '%d Background Apps', count).format(count);
}

const BackgroundAppRow = GObject.registerClass({GTypeName: 'BetterTrayIconsBackgroundAppRow'},
    class BackgroundAppRow extends PopupMenu.PopupBaseMenuItem {
        _init({iconActor, appId, title, settings, onAction}) {
            super._init({style_class: 'background-app-item'});
            this.add_style_class_name(EXPANDER_ROW_CLASS);

            this.iconActor = iconActor;
            this.appId = appId;
            this.message = null;
            this._onAction = onAction;

            // The row takes every click, the icon's own bindings stay with
            // the panel.
            iconActor.reactive = false;
            this.iconSlot = new St.Bin({child: iconActor, x_align: Clutter.ActorAlign.CENTER});
            this.add_child(this.iconSlot);

            const labels = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(labels);
            this._title = new St.Label({style_class: 'title'});
            labels.add_child(this._title);
            this._subtitle = new St.Label({style_class: 'subtitle', visible: false});
            labels.add_child(this._subtitle);
            this.setTitle(title);

            // PopupSubMenu turns an arrow while it unfolds, this row shows none
            this.menuArrow = new St.Icon({visible: false});
            this.add_child(this.menuArrow);

            // The item's own click gesture takes the release before any handler
            // sees it, the bindings need every button
            this._clickGesture.enabled = false;
            this._clickController = new ClickController(this, settings, TRAY_ACTION_PREFIX,
                action => this._onAction(action, Clutter.get_current_event()),
                {propagateEvent: true});
            this.connect('popup-menu', () => this._onAction('menu', null));
        }

        setDragged(isDragged) {
            this.opacity = isDragged ? DRAG_PLACEHOLDER_OPACITY : FULL_OPACITY;
        }

        setHeaderOpen(isOpen, body = null) {
            for (const pseudoClass of ['open', 'checked']) {
                if (isOpen)
                    this.add_style_pseudo_class(pseudoClass);
                else
                    this.remove_style_pseudo_class(pseudoClass);
            }
            if (body)
                joinCollapsible(this, body);
            else
                this.set_style(null);
        }

        // Only the keyboard gets here, the click gesture is off. No 'activate'
        // signal, the menu would fold on it.
        activate(event) {
            this._onAction('activate', event);
        }

        setTitle(title) {
            this._title.text = title || this.appId || '';
        }

        setMessage(message) {
            this.message = message ?? null;
            this._subtitle.text = message ?? '';
            this._subtitle.visible = !!message;
        }

        releaseIcon() {
            const actor = this.iconActor;
            if (isDisposed(actor))
                return;
            delete actor._trayTitleChanged;
            delete actor._trayRowSlot;
            actor._trayRestyle();
            delete actor._trayGrabManagers;
            actor.reactive = true;
            actor.get_parent()?.remove_child(actor);
        }
    });

function isKeyEvent(event) {
    const type = event?.type();
    return type === Clutter.EventType.KEY_PRESS || type === Clutter.EventType.KEY_RELEASE;
}
