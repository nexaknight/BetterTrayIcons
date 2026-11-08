import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {watchKeys} from '../../shared/lifecycle.js';
import {createBox, createLabel, ensurePrefsCss} from './text.js';

const CARD_WIDTH_PX = 110;
const CARD_HEIGHT_PX = 130;
const CARD_ICON_PX = 40;
// Three scene cards plus the strip's gaps and margins fit libadwaita's 576px
// content clamp, so a three-card picker only scrolls in a narrower window.
const STAGED_CARD_WIDTH_PX = 168;
// Two cards at this width plus gap and margins fit the 336px a prefs window
// at its 360px minimum leaves the strip.
const STAGED_CARD_MIN_WIDTH_PX = 156;
const CARD_TITLE_MAX_CHARS = 12;
// A staged card is wider than a captioned one, so its caption gets that room,
// and a long translation wraps once before it is cut.
const STAGED_TITLE_MAX_CHARS = 24;
const STAGED_TITLE_LINES = 2;
const CARD_SUBTITLE_MAX_CHARS = 14;

const CARD_CAPTION_GAP_PX = 4;
const CARD_CAPTION_TOP_PX = 10;
const CARD_CAPTION_BOTTOM_PX = 6;
const CARD_CAPTION_SIDE_PX = 8;
const STAGED_CAPTION_GAP_PX = 8;

const CARD_ROW_GAP_PX = 12;
const CARD_ROW_MARGIN_PX = 4;
// Adwaita's overlay scrollbar grows on hover and then reaches 17px up from the
// strip's bottom edge, against 8px while idle. The row margin adds air above.
const CARD_ROW_SCROLLBAR_ROOM_PX = 17;
// GTK's own wheel step, pow(page_size, 2/3) in gtkscrolledwindow.c.
const WHEEL_STEP_EXPONENT = 2 / 3;
// GTK's MAGIC_SCROLL_FACTOR for touchpad deltas in the same file.
const SURFACE_SCROLL_FACTOR = 2.5;

export function createCardPicker({title, description = '', settings, key, options, bleed = false}) {
    ensurePrefsCss();
    const group = new Adw.PreferencesGroup({title, description});

    const choices = new Map(options.map(option => [option.value, _createChoiceCard({
        preview: option.preview,
        bleed,
        title: option.label,
    })]));

    const [first, ...rest] = [...choices.values()].map(choice => choice.button);
    rest.forEach(button => button.set_group(first));
    const row = createCardRow({cards: [...choices.values()].map(choice => choice.card)});
    group.add(row);

    watchKeys(row, settings, [key], () => choices.get(settings.get_string(key))?.button.set_active(true));

    for (const [value, {button}] of choices) {
        button.connect('toggled', () => {
            if (button.active && settings.get_string(key) !== value)
                settings.set_string(key, value);
        });
    }

    return group;
}

function _createChoiceCard({preview, bleed, title}) {
    const stage = createBox({
        vexpand: true,
        cssClasses: bleed ? ['bti-card-stage', 'bleed'] : ['bti-card-stage'],
    });
    // GTK4 does not clip a child to its parent's rounded corners, so a scene
    // wider than the stage sticks out past its corners.
    stage.overflow = Gtk.Overflow.HIDDEN;
    const align = bleed ? Gtk.Align.FILL : Gtk.Align.CENTER;
    preview.set_halign(align);
    preview.set_valign(align);
    stage.append(preview);

    const button = new Gtk.ToggleButton({child: stage, css_classes: ['flat'], vexpand: true});
    button.update_property([Gtk.AccessibleProperty.LABEL], [title]);

    const caption = _createCardCaption(title, ['caption-heading'], STAGED_TITLE_MAX_CHARS, STAGED_TITLE_LINES);
    const pick = new Gtk.GestureClick();
    pick.connect('released', () => button.set_active(true));
    caption.add_controller(pick);

    const card = new Gtk.Box({
        layout_manager: new ShrinkingCardLayout({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: STAGED_CAPTION_GAP_PX,
        }),
        vexpand: false,
        css_classes: ['bti-choice-card'],
    });
    card.append(button);
    card.append(caption);
    return {card, button};
}

// Asks for the full card width but settles for the floor, so a strip that
// is a little short shrinks its cards before it starts to scroll.
const ShrinkingCardLayout = GObject.registerClass(
    {GTypeName: 'BetterTrayIconsShrinkingCardLayout'},
    class ShrinkingCardLayout extends Gtk.BoxLayout {
        vfunc_measure(widget, orientation, forSize) {
            const [min, natural] = super.vfunc_measure(widget, orientation, forSize);
            if (orientation === Gtk.Orientation.VERTICAL)
                return [min, natural, -1, -1];
            return [Math.max(min, STAGED_CARD_MIN_WIDTH_PX), Math.max(natural, STAGED_CARD_WIDTH_PX), -1, -1];
        }
    });

export function createCard({
    avatar = null,
    iconName = null,
    iconSize = CARD_ICON_PX,
    title = '',
    subtitle = '',
    onActivate,
    tooltip,
}) {
    const button = new Gtk.Button({
        css_classes: ['card', 'flat'],
        width_request: CARD_WIDTH_PX,
        height_request: CARD_HEIGHT_PX,
        valign: Gtk.Align.CENTER,
        // GTK expands a parent whose child expands, and the picture's vexpand
        // would otherwise grow the card to the full page height.
        vexpand: false,
        child: _buildCaptionedCard({avatar, iconName, iconSize, title, subtitle}),
        tooltip_text: tooltip,
    });
    button.connect('clicked', onActivate);
    return button;
}

function _buildCaptionedCard({avatar, iconName, iconSize, title, subtitle}) {
    const box = createBox({
        spacing: CARD_CAPTION_GAP_PX,
        halign: 'center',
        // FILL keeps the caption a fixed distance from the bottom edge. Under
        // CENTER a taller picture leaves captions across a row unaligned.
        valign: 'fill',
        margin_top: CARD_CAPTION_TOP_PX,
        margin_bottom: CARD_CAPTION_BOTTOM_PX,
        margin_start: CARD_CAPTION_SIDE_PX,
        margin_end: CARD_CAPTION_SIDE_PX,
    });

    let top = avatar;
    if (!top && iconName)
        top = new Gtk.Image({icon_name: iconName, pixel_size: iconSize});
    if (top) {
        top.set_halign(Gtk.Align.CENTER);
        top.set_valign(Gtk.Align.CENTER);
        top.set_vexpand(true);
        box.append(top);
    }

    if (title)
        box.append(_createCardCaption(title, ['caption-heading'], CARD_TITLE_MAX_CHARS));
    if (subtitle)
        box.append(_createCardCaption(subtitle, ['caption', 'dimmed'], CARD_SUBTITLE_MAX_CHARS));

    return box;
}

function _createCardCaption(text, cssClasses, maxChars, lines = 1) {
    return createLabel(text, cssClasses, {
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: maxChars,
        halign: Gtk.Align.CENTER,
        ...lines > 1 ? {wrap: true, lines, justify: Gtk.Justification.CENTER} : {},
    });
}

export function createCardRow({cards}) {
    const strip = new Gtk.Box({
        spacing: CARD_ROW_GAP_PX,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START,
        margin_top: CARD_ROW_MARGIN_PX,
        margin_bottom: CARD_ROW_MARGIN_PX,
        margin_start: CARD_ROW_MARGIN_PX,
        margin_end: CARD_ROW_MARGIN_PX,
    });
    cards.forEach(c => strip.append(c));

    const scroller = new CardStrip({
        child: strip,
        hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        vscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    _scrollWheelSideways(scroller);
    return scroller;
}

// The overlay scrollbar would cover the captions, so the strip grows by its
// room only at a width where there is something to scroll.
const CardStrip = GObject.registerClass(
    {GTypeName: 'BetterTrayIconsCardStrip'},
    class CardStrip extends Gtk.ScrolledWindow {
        vfunc_get_request_mode() {
            return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
        }

        vfunc_measure(orientation, forSize) {
            const [min, natural] = super.vfunc_measure(orientation, forSize);
            if (orientation === Gtk.Orientation.HORIZONTAL || forSize < 0)
                return [min, natural, -1, -1];
            const [contentMin] = this.child.measure(Gtk.Orientation.HORIZONTAL, -1);
            const room = contentMin > forSize ? CARD_ROW_SCROLLBAR_ROOM_PX : 0;
            return [min + room, natural + room, -1, -1];
        }
    });

// A mouse wheel and a touchpad's vertical swipe scroll the strip sideways.
// At the end it is moving towards, the event goes on to the page instead,
// otherwise the strip would swallow the page scroll.
function _scrollWheelSideways(scroller) {
    const controller = new Gtk.EventControllerScroll({
        flags: Gtk.EventControllerScrollFlags.VERTICAL,
        propagation_phase: Gtk.PropagationPhase.CAPTURE,
    });
    controller.connect('scroll', (_controller, _dx, dy) => {
        const adjustment = scroller.hadjustment;
        const isAtStart = adjustment.value <= adjustment.lower;
        const isAtEnd = adjustment.value >= adjustment.upper - adjustment.page_size;
        const isPastEnd = (dy > 0 && isAtEnd) || (dy < 0 && isAtStart);
        if (dy === 0 || isPastEnd)
            return Gdk.EVENT_PROPAGATE;
        const step = controller.get_unit() === Gdk.ScrollUnit.WHEEL
            ? Math.pow(adjustment.page_size, WHEEL_STEP_EXPONENT)
            : SURFACE_SCROLL_FACTOR;
        adjustment.value += dy * step;
        return Gdk.EVENT_STOP;
    });
    scroller.add_controller(controller);
}
