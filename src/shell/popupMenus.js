import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isDisposed} from './disposal.js';
import {isInAnyPanel, panelCopies, panelCopyFor} from './panelCopies.js';
import {shellUsesLightStyle} from './trayStyle.js';
import {THEME_FOREGROUND} from '../shared/colorContrast.js';
import {DISPLAY_MODE} from '../const.js';
import {clearIds, debounceTo, disconnectSignal, removeTimer} from '../shared/lifecycle.js';

// Opening upwards, the theme's bottom margin and the arrow rise leave a
// visible hole over the bar.
const RAISED_MENU_GAP_PX = 8;
const RAISED_MENU_CSS =
    `-arrow-rise: 0px; -boxpointer-gap: ${RAISED_MENU_GAP_PX}px; margin-bottom: 0px;`;

const QUICK_SETTINGS_EDGE_PX = 24;

const LIGHT_MENU_CSS = `background-color: #ffffff; color: ${THEME_FOREGROUND.onLight};`;

const COLOR_CHANNEL_MAX = 255;

// The joined body's inset, page/styles/landing/_quickSettings.scss
// .qs-inline-menu
const JOINED_INSET_PX = 6;
const JOINED_BODY_PADDING_CSS = `4px ${JOINED_INSET_PX}px ${JOINED_INSET_PX}px`;

// An app gets this long to answer or to focus its new window before the
// menus take their grabs back, a menu must not stay open without one
const GRAB_RELEASE_MAX_MS = 1500;

// Menus on 51 take an options object, 49 and 50 a BoxPointer flag, and
// PopupMenuBase only grew open and close on 51.
const MENU_TAKES_PARAMS = PopupMenu.PopupMenuBase.prototype.open !== undefined;

// GTK's overlay scrollbar timing, INDICATOR_FADE_OUT_DELAY and
// INDICATOR_FADE_OUT_DURATION in gtk/gtkscrolledwindow.c
const SCROLLBAR_IDLE_MS = 2000;
const SCROLLBAR_FADE_MS = 1000;

// A 4px thumb two pixels off the edge of the theme's 8px bar, the overlay
// scrollbar in page/styles/_mixins.scss
const SCROLLBAR_THUMB_INSET_PX = 2;

const SCROLLBAR_SHOWN_OPACITY = 255;

export function menuAnimation(animate) {
    if (MENU_TAKES_PARAMS)
        return {animate};
    return animate ? BoxPointer.PopupAnimation.FULL : BoxPointer.PopupAnimation.NONE;
}

export const POPUP_ANIMATION_NONE = menuAnimation(false);
export const POPUP_ANIMATION_FULL = menuAnimation(true);

export function createPanelMenu(sourceActor, {configure = null, ownSurface = false, parent = Main.layoutManager.uiGroup} = {}) {
    const side = isInQuickSettings(sourceActor) ? sideAwayFromCenter(sourceActor) : St.Side.TOP;
    const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, side);
    menu.actor.add_style_class_name('panel-menu');
    configure?.(menu);

    const baseStyle = menu.actor.get_style() ?? '';
    menu.connect('open-state-changed', (_menu, isOpen) => {
        if (!isOpen)
            return;
        const isRaised = side === St.Side.TOP && menuOpensUpwards(sourceActor);
        menu.actor.set_style(isRaised
            ? `${baseStyle} ${RAISED_MENU_CSS}`
            : baseStyle);
        if (!ownSurface)
            applyMenuBoxStyle(menu);
    });

    parent.add_child(menu.actor);
    menu.actor.hide();
    return menu;
}

// The arrow side names where the arrow sits, so a menu meant to open
// leftwards points its arrow right.
function sideAwayFromCenter(sourceActor) {
    const [x, , width] = sourceRect(sourceActor);
    const monitor = Main.layoutManager.findMonitorForActor(sourceActor);
    const isRightHalf = x + width / 2 > monitor.x + monitor.width / 2;
    return isRightHalf ? St.Side.RIGHT : St.Side.LEFT;
}

// Not "is it in the panel", an extension can move Main.panel itself to the
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

export function isInQuickSettings(actor) {
    return quickSettingsAround(actor) !== null;
}

// A panel on another monitor can carry a Quick Settings of its own
function quickSettingsAround(actor) {
    return panelCopies().map(copy => copy.quickSettings)
        .find(quickSettings => quickSettings?.menu.actor.contains(actor)) ?? null;
}

// Quick Settings never scrolls, so a list inside it gets what the work area
// leaves next to everything else Quick Settings shows. No position goes in,
// it grows upwards above a bottom panel and a box too tall flips sides.
export function quickSettingsRoom(actor, ownHeight) {
    const quickSettings = quickSettingsAround(actor);
    const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.findIndexForActor(quickSettings));
    return workArea.height - (quickSettings.menu.box.height - ownHeight) - 2 * QUICK_SETTINGS_EDGE_PX;
}

export function menuForegroundColor() {
    return shellUsesLightStyle() ? THEME_FOREGROUND.onLight : THEME_FOREGROUND.onDark;
}

// The surface color, a pinned width and a joined body's clear box share the
// box style, and whoever writes it alone drops the others.
export function applyMenuBoxStyle(menu, pinnedWidthCss = null) {
    if (pinnedWidthCss !== null)
        menu._pinnedWidthCss = pinnedWidthCss;
    menu._surfaceCss = shellUsesLightStyle() ? LIGHT_MENU_CSS : null;
    syncBoxStyle(menu);
}

// A scroll cap and a joined look both style the same submenu
export function setStylePart(actor, owner, css) {
    actor._styleParts ??= new Map();
    if (css)
        actor._styleParts.set(owner, css);
    else
        actor._styleParts.delete(owner);
    actor.set_style([...actor._styleParts.values()].join(' ') || null);
}

function syncBoxStyle(menu) {
    const css = [menu._surfaceCss, menu._pinnedWidthCss, menu._joinedBoxCss].filter(Boolean).join(' ');
    menu.box.set_style(css || null);
}

// Popup icons anchor to the dummy cursor, an intellihide panel otherwise
// slides away mid-menu and takes the menu with it.
export function menuAnchorFor(actor) {
    if (isInAnyPanel(actor) || isInQuickSettings(actor))
        return actor;

    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    Main.layoutManager.setDummyCursorGeometry(x, y, w, h);
    return Main.layoutManager.dummyCursor;
}

// Drawer mode reads its own key, the popup's one is about keeping a menu open
export function keepsOverflowOpen(settings) {
    const key = settings.get_string('display-mode') === DISPLAY_MODE.DRAWER ? 'drawer-remember-state' : 'keep-popup-after-click';
    return settings.get_boolean(key);
}

let _detachedMenuManager = null;

// The panel manager closes its open menu when another opens, which would shut
// the popup under a context menu opened from inside it. Quick Settings has to
// stay open under its menus either way.
export function menuManagerFor(actor, settings) {
    const keepsOwner = settings.get_boolean('keep-popup-after-click') && !isInAnyPanel(actor);
    if (keepsOwner || isInQuickSettings(actor)) {
        _detachedMenuManager ??= new PopupMenu.PopupMenuManager(Main.panel);
        return _detachedMenuManager;
    }
    return panelMenuManagerFor(actor);
}

// Each monitor's panel switches between its own menus on hover, never over
// to another monitor's
export function panelMenuManagerFor(actor) {
    return panelCopyFor(actor)?.menuManager ?? Main.panel.menuManager;
}

export function clearDetachedMenuManager() {
    _detachedMenuManager = null;
}

let _releasedGrabs = null;

// Popping the grabs hands the keyboard to the app's window while the menus
// stay on screen, restoreMenuGrabs pushes them back
export function releaseMenuGrabs(managers) {
    if (!_releasedGrabs) {
        const held = managers.filter(manager => manager._grab);
        const focus = global.stage.get_key_focus();
        const released = {managers: held, focus, timeoutId: 0, focusWindowId: 0, focusDestroyId: 0};
        released.focusDestroyId = focus?.connect('destroy', () => {
            released.focus = null;
            released.focusDestroyId = 0;
        }) ?? 0;
        _releasedGrabs = released;
        held.toReversed().forEach(manager => Main.popModal(manager._grab));
    }
    debounceTo(_releasedGrabs, 'timeoutId', GRAB_RELEASE_MAX_MS, restoreMenuGrabs);
}

// A window that maps after the app answered takes focus only while no grab
// is held, so the grabs wait for it
export function restoreMenuGrabsOnFocus() {
    if (!_releasedGrabs || _releasedGrabs.focusWindowId)
        return;
    _releasedGrabs.focusWindowId = global.display.connect('notify::focus-window', restoreMenuGrabs);
}

export function restoreMenuGrabs() {
    const released = _releasedGrabs;
    if (!released)
        return;
    _releasedGrabs = null;
    clearIds(released, removeTimer, 'timeoutId');
    disconnectSignal(released, global.display, 'focusWindowId');
    disconnectSignal(released, released.focus, 'focusDestroyId');
    for (const manager of released.managers) {
        const menu = manager.activeMenu;
        manager._grab = menu ? Main.pushModal(menu.actor, manager._grabParams) : null;
    }
    released.focus?.grab_key_focus();
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

    // Early 51 builds leave the menu's key controller on the source actor,
    // later ones drop it in destroy, and our popup icons all share one dummy cursor
    const keyController = menu._keyController;
    keyController?.get_actor()?.remove_action(keyController);
}

// The bar floats in the right padding of whatever frames the content, so rows
// keep their full width, and it fades out once idle like GTK's overlay
// scrollbars. Stock St keeps a bar up for good.
export function overlayScrollbar(view, frame = null) {
    // St has no getter for its bars, they are its only own children
    const bar = view.get_children().find(child => child.orientation === Clutter.Orientation.VERTICAL);
    const handle = bar.get_children().find(child => child.has_style_class_name('vhandle'));
    view.overlay_scrollbars = true;
    bar.opacity = 0;
    handle.set_style(`border-width: ${SCROLLBAR_THUMB_INSET_PX}px;`);

    const fadeTo = opacity => bar.ease({
        opacity,
        duration: SCROLLBAR_FADE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });
    const hideWhenIdle = () => debounceTo(view, '_scrollbarIdleId', SCROLLBAR_IDLE_MS, () => {
        if (bar.has_pointer)
            hideWhenIdle();
        else
            fadeTo(0);
    });
    const reveal = () => {
        // Moved, not laid out there, St places its bars inside the padding
        bar.translation_x = rightRoom(view) + (frame ? rightRoom(frame) : 0);
        fadeTo(SCROLLBAR_SHOWN_OPACITY);
        hideWhenIdle();
    };
    view.vadjustment.connect('notify::value', reveal);
    view.connect('captured-event', (_view, event) => {
        if (event.type() === Clutter.EventType.MOTION)
            reveal();
        return Clutter.EVENT_PROPAGATE;
    });
    view.connect('destroy', () => clearIds(view, removeTimer, '_scrollbarIdleId'));
}

function rightRoom(actor) {
    return actor.get_theme_node().get_padding(St.Side.RIGHT);
}

const _flyoutMenus = [];
let _flyoutGrabState = null;

export function clearFlyoutMenus() {
    for (const menu of [..._flyoutMenus].reverse())
        menu._releaseGrab();
    _flyoutMenus.length = 0;
    _flyoutGrabState = null;
}

export class FlyoutMenu extends PopupMenu.PopupMenu {
    constructor(item) {
        super(item, 0, St.Side.LEFT);
        this._grab = null;
        this._capturedEventId = 0;
        this._boxPointer.bin.set_child(null);
        this._scrollView = new St.ScrollView({
            child: this.box,
            hscrollbar_policy: St.PolicyType.NEVER,
        });
        overlayScrollbar(this._scrollView);
        this._boxPointer.bin.set_child(this._scrollView);
        Main.layoutManager.uiGroup.add_child(this.actor);
        this.actor.hide();
        this.connect('open-state-changed', (menu, isOpen) => {
            if (!isOpen) {
                this._releaseGrab();
                return;
            }
            applyMenuBoxStyle(this);
            this._fitWorkArea();
            this._takeGrab();
        });
    }

    // The box pointer keeps a menu taller than the work area flush with its
    // bottom, which pushes the first rows off the top of the screen
    _fitWorkArea() {
        const menu = this.actor;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            Main.layoutManager.findIndexForActor(this.sourceActor));
        const edgeGap = 2 * menu.get_theme_node().get_length('-arrow-rise');
        const margins = menu.margin_top + menu.margin_bottom;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const maxHeight = Math.floor((workArea.height - margins - edgeGap) / scale);
        menu.set_style(`max-height: ${maxHeight}px;`);
    }

    get ownerMenu() {
        return this.sourceActor._getTopMenu();
    }

    _takeGrab() {
        const layer = Main.layoutManager.uiGroup;
        if (_flyoutMenus.length === 0) {
            _flyoutGrabState = {
                reactive: layer.reactive,
                sourceActor: layer._sourceActor,
            };
        }
        _flyoutMenus.push(this);
        // Clutter only delivers to reactive actors, the grab alone sees nothing
        layer.reactive = true;
        this._grab = Main.pushModal(layer, {actionMode: Shell.ActionMode.POPUP});
        // An auto hiding panel checks the grab's _sourceActor before it hides
        layer._sourceActor = menuChainFrom(this).at(-1).sourceActor;
        this.actor.grab_key_focus();
        this._capturedEventId = layer.connect('captured-event',
            (actor, event) => this._onCapturedEvent(event));
    }

    _releaseGrab() {
        if (!this._grab)
            return;
        const layer = Main.layoutManager.uiGroup;
        disconnectSignal(this, layer, '_capturedEventId');
        Main.popModal(this._grab);
        this._grab = null;

        _flyoutMenus.splice(_flyoutMenus.indexOf(this), 1);
        if (_flyoutMenus.length > 0) {
            layer._sourceActor = menuChainFrom(_flyoutMenus.at(-1)).at(-1).sourceActor;
        } else {
            layer.reactive = _flyoutGrabState.reactive;
            if (_flyoutGrabState.sourceActor === undefined)
                delete layer._sourceActor;
            else
                layer._sourceActor = _flyoutGrabState.sourceActor;
            _flyoutGrabState = null;
        }
    }

    _onCapturedEvent(event) {
        // Nested flyouts share the capture actor, only the top grab handles input
        if (_flyoutMenus.at(-1) !== this)
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS &&
            this._handleFlyoutKey(event) === Clutter.EVENT_STOP)
            return Clutter.EVENT_STOP;

        const target = global.stage.get_event_actor(event);
        const chain = menuChainFrom(this);
        const isPress = type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.TOUCH_BEGIN;
        if (!isPress) {
            return chain.some(menu => menu.actor.contains(target))
                ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
        }

        // Every link but the last hangs off a menu item. A press on that item
        // runs its own toggle, closing here would let the release reopen it.
        const toggled = chain.slice(0, -1).find(menu => menu.sourceActor.contains(target));
        const pressed = toggled || chain.find(menu => menu.actor.contains(target));
        for (const menu of chain) {
            if (menu === pressed)
                break;
            menu.close(POPUP_ANIMATION_FULL);
        }
        // The click that closes everything must not also hit what is behind
        return pressed ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
    }

    _handleFlyoutKey(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this.close(POPUP_ANIMATION_FULL);
            return Clutter.EVENT_STOP;
        }

        const isMenuFocused = global.stage.get_key_focus() === this.actor;
        if (symbol === Clutter.KEY_Down && isMenuFocused) {
            this.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        this._releaseGrab();
        super.destroy();
    }
}

function menuChainFrom(menu) {
    const chain = [menu];
    let current = menu;
    while (current.sourceActor instanceof PopupMenu.PopupBaseMenuItem) {
        current = current.sourceActor._getTopMenu();
        chain.push(current);
    }
    return chain;
}

export function closeMenuChain(menu) {
    const chain = menuChainFrom(menu);
    for (const link of chain)
        link.close(POPUP_ANIMATION_NONE);
    return chain.at(-1);
}

// The shell draws every submenu level on one surface and edge, so nested open
// levels read as overlapping boxes. The shell also drops `checked` as the fold
// starts, the header would round off while the body is still shrinking.
export function bindCollapsibleLook(item) {
    item.menu.connect('open-state-changed', (submenu, isOpen) => {
        if (isOpen)
            styleCollapsible(item, submenu);
        else
            item.add_style_pseudo_class('checked');
    });
    item.menu.actor.connect('hide', () => styleCollapsible(item, null));
}

// Inline, an open header and its body form one block on one surface, levels
// alternate between two shades and only the body steps in. A side flyout hangs
// nothing under the header, so the header rounds on every corner.
export function styleCollapsible(item, body) {
    if (!body) {
        item.remove_style_pseudo_class('checked');
        item.set_style(item._joinedItemCss ?? null);
        unjoinBody(item.menu);
        return;
    }
    item.add_style_pseudo_class('checked');
    if (body !== item.menu) {
        const radius = item.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
        item.set_style(`${item._joinedItemCss ?? ''} border-radius: ${radius}px !important;`);
        return;
    }
    // Every second level takes the header's own shade. Without one, the
    // body's see-through surface stacks on its parent's and steps anyway.
    const ownShade = item.get_theme_node().get_background_color();
    const surface = nestingDepth(item) % 2 === 0 && ownShade.alpha > 0 ? ownShade : null;
    joinCollapsible(item, body, surface);
}

// The block takes the body's surface unless a level asks for its own. A blur
// extension clears the body and paints its box instead, the box's shade then
// moves out to the body so the inset around the rows is covered too.
// The look follows page/styles/landing/_quickSettings.scss .qs-inline-menu.
export function joinCollapsible(header, body, surface = null) {
    surface ??= bodySurface(body);
    const radius = header.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
    const gap = body.actor.get_theme_node().get_margin(St.Side.BOTTOM);
    // The bottom margin goes above the header too, the open block then
    // stands apart from its siblings on both ends
    header.set_style(`${header._joinedItemCss ?? ''} ${surfaceCss(surface)}
        border-radius: ${radius}px ${radius}px 0 0; margin-top: ${gap}px;`);
    setStylePart(body.actor, 'joined', `${surfaceCss(surface)} border-width: 0;
        border-radius: 0 0 ${radius}px ${radius}px; padding: ${JOINED_BODY_PADDING_CSS};`);
    body._joinedBoxCss = 'background-color: transparent;';
    syncBoxStyle(body);

    body._joinedItemRadius = radius;
    body.box.get_children().forEach(child => insetJoinedItem(body, child));
    body._insetSignalId ??= body.box.connect('child-added', (_box, child) => insetJoinedItem(body, child));
}

function unjoinBody(body) {
    setStylePart(body.actor, 'joined', null);
    delete body._joinedBoxCss;
    delete body._joinedItemRadius;
    syncBoxStyle(body);
}

function bodySurface(body) {
    const surface = body.actor.get_theme_node().get_background_color();
    return surface.alpha > 0 ? surface : body.box.get_theme_node().get_background_color();
}

// The body steps its rows in and the rows give that back from their own
// padding, so their text stays in line with the header's
function insetJoinedItem(body, item) {
    if (body._joinedItemRadius === undefined || !(item instanceof PopupMenu.PopupBaseMenuItem))
        return;
    item._themePaddingPx ??= item.get_theme_node().get_padding(St.Side.LEFT);
    const padding = Math.max(0, item._themePaddingPx - JOINED_INSET_PX);
    // The theme cuts a submenu's separators short on one side
    const separatorCss = item instanceof PopupMenu.PopupSeparatorMenuItem ? 'margin-left: 0; margin-right: 0;' : '';
    item._joinedItemCss = `border-radius: ${body._joinedItemRadius}px;
        padding-left: ${padding}px; padding-right: ${padding}px; ${separatorCss}`;
    // An open level keeps its header look, the next restyle picks this up
    if (!item.menu?.isOpen)
        item.set_style(item._joinedItemCss);
}

function surfaceCss({red, green, blue, alpha}) {
    return `background-color: rgba(${red}, ${green}, ${blue}, ${alpha / COLOR_CHANNEL_MAX});`;
}

// A header straight in a popup is level one, every submenu around it adds one
function nestingDepth(item) {
    let depth = 1;
    for (let menu = item._parent; menu; menu = menu._parent) {
        if (menu instanceof PopupMenu.PopupSubMenu)
            depth++;
    }
    return depth;
}

// A menu taller than its side of the icon makes the box pointer flip
// sides, a menu over the bar then lands below it.
export function submenuFitsInline(submenu) {
    const topMenu = submenu._getTopMenu();
    // The Background Apps list and its inline menus scroll once they run out
    if (isInQuickSettings(topMenu.actor))
        return true;
    const [, menuHeight] = topMenu.actor.get_preferred_height(-1);
    const [, submenuHeight] = submenu.actor.get_preferred_height(-1);
    return menuHeight + submenuHeight <= inlineRoom(topMenu);
}

// Above or below the icon the menu can only grow away from it. Next to
// it the box pointer just slides it along the work area.
function inlineRoom(topMenu) {
    const menu = topMenu.actor;
    const [, sourceTop] = topMenu.sourceActor.get_transformed_position();
    const [, sourceHeight] = topMenu.sourceActor.get_transformed_size();
    const workArea = Main.layoutManager.getWorkAreaForMonitor(
        Main.layoutManager.findIndexForActor(menu));
    const margins = menu.margin_top + menu.margin_bottom;

    if (menu.y + menu.height <= sourceTop)
        return menu.y + menu.height - workArea.y - margins;
    if (menu.y >= sourceTop + sourceHeight)
        return workArea.y + workArea.height - menu.y - margins;
    return workArea.height - margins;
}
