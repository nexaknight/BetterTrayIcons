import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {badgeCssClasses, createBadge} from './badge.js';
import {createIconButton} from './button.js';
import {clearChildren, ensurePrefsCss, getChildren} from './text.js';

const SEARCH_ICON_NAME = 'bti-search-symbolic';
const REMOVE_ICON_NAME = 'bti-close-symbolic';

const BAR_GAP_PX = 8;
const CHIP_GAP_PX = 4;

export class TokenSearch extends Gtk.Box {
    static {
        GObject.registerClass({
            GTypeName: 'BetterTrayIconsTokenSearch',
            Signals: {changed: {}},
        }, this);
    }

    _init({placeholder}) {
        super._init({spacing: BAR_GAP_PX, css_classes: ['bti-token-search']});
        ensurePrefsCss();
        this._options = [];
        this._picked = [];

        this.append(new Gtk.Image({icon_name: SEARCH_ICON_NAME}));
        this._chips = new Gtk.Box({spacing: CHIP_GAP_PX});
        this.append(this._chips);
        this._text = new Gtk.Text({placeholder_text: placeholder, hexpand: true});
        this._text.update_property([Gtk.AccessibleProperty.LABEL], [placeholder]);
        this.append(this._text);

        this._buildSuggestions();
        this._connectText();
        this.connect('map', () => this._watchDismissal());
        this.connect('unmap', () => this._unwatchDismissal());
    }

    get tokens() {
        return this._picked.map(({option}) => option.text);
    }

    get query() {
        return this._text.text.trim().toLowerCase();
    }

    // A popover parented by hand is only placed when its parent presents it,
    // without this it keeps the spot it got while the bar slid in
    vfunc_size_allocate(width, height, baseline) {
        super.vfunc_size_allocate(width, height, baseline);
        this._suggestions.present();
    }

    // The bar itself takes no focus, the text inside it does
    vfunc_grab_focus() {
        return this._text.grab_focus();
    }

    setOptions(options) {
        this._options = options;
        this._syncSuggestions();
    }

    clear() {
        this._picked = [];
        clearChildren(this._chips);
        this._text.text = '';
        this.emit('changed');
    }

    _buildSuggestions() {
        this._list = new Gtk.ListBox({
            css_classes: ['bti-menu-list', 'bti-suggestions'],
            can_focus: false,
            activate_on_single_click: true,
        });
        this._list.connect('row-activated', (_list, row) => this._pick(row._btiOption));

        // Focus stays in the text while the popover is up, the arrow keys move
        // the selection instead
        this._suggestions = new Gtk.Popover({
            child: this._list,
            autohide: false,
            has_arrow: false,
            css_classes: ['menu', 'bti-suggestions'],
            halign: Gtk.Align.START,
            position: Gtk.PositionType.BOTTOM,
        });
        this._suggestions.set_parent(this);
    }

    _connectText() {
        this._text.connect('changed', () => {
            this._syncSuggestions();
            this.emit('changed');
        });
        this._text.connect('activate', () => this._pickSelected());

        this._focus = new Gtk.EventControllerFocus();
        this._focus.connect('enter', () => this._syncSuggestions());
        this._focus.connect('leave', () => this._suggestions.popdown());
        this._text.add_controller(this._focus);

        // Focus can sit in the text after an outside press closed the list,
        // then only a press brings it back
        const press = new Gtk.GestureClick();
        press.connect('pressed', () => this._syncSuggestions());
        this._text.add_controller(press);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, keyval) => this._onKey(keyval));
        this._text.add_controller(keys);
    }

    // A press on the page body moves no focus, so the text keeps it and the
    // focus leave alone never fires. The capture phase sees the press before
    // a row or button below can claim it.
    _watchDismissal() {
        this._outsideClick = new Gtk.GestureClick({
            button: 0,
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        this._outsideClick.connect('pressed', (gesture, _nPress, x, y) => {
            if (!this._isInside(gesture, x, y))
                this._suggestions.popdown();
        });
        this._clickRoot = this.get_root();
        this._clickRoot.add_controller(this._outsideClick);

        // The popover only moves when the bar presents it, a scroll would
        // leave it hanging where the bar used to be. The scroll input closes
        // it, not the adjustment, a shorter list moves that too.
        this._scrollWatch = new Gtk.EventControllerScroll({
            flags: Gtk.EventControllerScrollFlags.BOTH_AXES,
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        this._scrollWatch.connect('scroll', () => {
            this._suggestions.popdown();
            return Gdk.EVENT_PROPAGATE;
        });
        this._scroller = this.get_ancestor(Gtk.ScrolledWindow.$gtype);
        this._scroller.add_controller(this._scrollWatch);
    }

    _unwatchDismissal() {
        this._suggestions.popdown();
        this._clickRoot.remove_controller(this._outsideClick);
        this._scroller.remove_controller(this._scrollWatch);
        this._clickRoot = null;
        this._outsideClick = null;
        this._scroller = null;
        this._scrollWatch = null;
    }

    _isInside(gesture, x, y) {
        if (gesture.get_current_event().get_surface() === this._suggestions.get_surface())
            return true;
        const target = this._clickRoot.pick(x, y, Gtk.PickFlags.DEFAULT);
        return target === this || target.is_ancestor(this);
    }

    _onKey(keyval) {
        switch (keyval) {
        case Gdk.KEY_Down:
            return this._moveSelection(1);
        case Gdk.KEY_Up:
            return this._moveSelection(-1);
        case Gdk.KEY_Escape:
            return this._closeSuggestions();
        case Gdk.KEY_BackSpace:
            return this._dropLastChip();
        default:
            return Gdk.EVENT_PROPAGATE;
        }
    }

    _moveSelection(step) {
        if (!this._suggestions.visible)
            return Gdk.EVENT_PROPAGATE;
        const rows = getChildren(this._list);
        const current = rows.indexOf(this._list.get_selected_row());
        const next = rows[current + step];
        if (next)
            this._list.select_row(next);
        else if (step < 0)
            this._list.unselect_all();
        return Gdk.EVENT_STOP;
    }

    _closeSuggestions() {
        if (!this._suggestions.visible)
            return Gdk.EVENT_PROPAGATE;
        this._suggestions.popdown();
        return Gdk.EVENT_STOP;
    }

    _dropLastChip() {
        if (this._text.text !== '' || this._picked.length === 0)
            return Gdk.EVENT_PROPAGATE;
        this._unpick(this._picked.at(-1));
        return Gdk.EVENT_STOP;
    }

    // Enter without an arrow pick takes the best match, so typing part of a
    // badge name and pressing Enter is enough
    _pickSelected() {
        const selected = this._list.get_selected_row();
        const hasPick = selected || this._text.text !== '';
        if (!this._suggestions.visible || !hasPick)
            return;
        this._pick((selected ?? getChildren(this._list)[0])._btiOption);
    }

    _pick(option) {
        const entry = {option, chip: null};
        entry.chip = this._createChip(entry);
        this._picked.push(entry);
        this._chips.append(entry.chip);
        this._text.text = '';
        this._syncSuggestions();
        this.emit('changed');
    }

    _unpick(entry) {
        this._picked.splice(this._picked.indexOf(entry), 1);
        this._chips.remove(entry.chip);
        this._text.grab_focus();
        this._syncSuggestions();
        this.emit('changed');
    }

    _createChip(entry) {
        const {option} = entry;
        const chip = new Gtk.Box({
            spacing: CHIP_GAP_PX,
            valign: Gtk.Align.CENTER,
            css_classes: [...badgeCssClasses(option.variant), 'bti-chip'],
        });
        chip.append(new Gtk.Label({label: option.text}));
        const remove = createIconButton(REMOVE_ICON_NAME, {
            tooltip: _('Remove'),
            onClick: () => this._unpick(entry),
        });
        remove.update_property([Gtk.AccessibleProperty.LABEL], [_('Remove')]);
        chip.append(remove);
        return chip;
    }

    _syncSuggestions() {
        const query = this.query;
        const matches = this._options.filter(option =>
            !this._picked.some(picked => picked.option.text === option.text) &&
            option.text.toLowerCase().includes(query));
        if (!this._focus.contains_focus || matches.length === 0) {
            this._suggestions.popdown();
            return;
        }

        this._list.remove_all();
        for (const option of matches) {
            const badge = createBadge(option);
            badge.halign = Gtk.Align.START;
            const row = new Gtk.ListBoxRow({child: badge, can_focus: false});
            row._btiOption = option;
            this._list.append(row);
        }
        this._suggestions.popup();
    }
}
