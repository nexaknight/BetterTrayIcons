import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {disconnectSignal} from '../../shared/lifecycle.js';
import {error} from '../../shared/logging.js';
import {EMOJI_ICON_PREFIX, bundledOrThemedIcon, isEmojiIcon} from '../../shared/iconLoading.js';
import {createBox, createLabel} from './text.js';
import {createIconButton} from './button.js';
import {createFileFilter, openFileChooser} from './dialog.js';
import {createImage, readIconTexture} from './image.js';
import {loadEmojiCatalog} from './emoji.js';
import {applyPathIcon, prefsForegroundColor, themeIconFile} from './icon.js';
import {isIconPackPath, listIconPacks, loadPackIcons, packIconIndex, packIconPath} from '../iconPacks.js';

// A 36px cell with a 4px gap is one column. Fourteen of them set the popover
// width, and the nine emoji tabs share that width evenly.
const CELL_SIZE_PX = 36;
const COLUMN_WIDTH_PX = 40;
const MAX_COLUMNS = 14;
const MIN_COLUMNS = 6;
const RECENT_EMOJI_ROWS = 2;
const RECENT_EMOJIS_MAX = MAX_COLUMNS * RECENT_EMOJI_ROWS;
const RECENT_EMOJIS_KEY = 'recent-emojis';

const POPOVER_HEIGHT_PX = 520;
const POPOVER_MIN_HEIGHT_PX = 240;
const WINDOW_MARGIN_PX = 48;
// What libadwaita draws around the content, arrow, padding and shadow. An
// unmapped popover measures none of it.
const POPOVER_CHROME_PX = 76;

// Every grid row has this height, so a row's offset is its index times the
// height and the scroll position names its row without measuring.
const ROW_HEIGHT_PX = COLUMN_WIDTH_PX;
const TITLE_BOTTOM_GAP_PX = 4;
const CELL_MARGIN_PX = (ROW_HEIGHT_PX - CELL_SIZE_PX) / 2;
const GRID_ICON_SIZE_PX = 24;
const SEARCH_ICON_NAME = 'bti-search-symbolic';
const ICONS_PER_FRAME = 26;
const PACK_LOADS_PER_FRAME = 13;
const SCROLL_SETTLE_US = 100 * 1000;
// Scrolling back reuses these instead of decoding the files again.
const PACK_TEXTURE_CACHE_MAX = 800;
const PREVIEW_ICON_SIZE_PX = 64;
const CELL_TITLE = -1;
const CELL_FILLER = -2;
const CELL_POOL_SIZE = 2048;

const LAYOUT_GAP_PX = 8;
const TAB_GAP_PX = 4;
const CUSTOM_GAP_PX = 12;

const CELL_CLASSES = ['flat', 'circular', 'bti-picker-cell'];
const CURRENT_CELL_CLASSES = ['suggested-action', 'circular', 'bti-picker-cell'];
const TITLE_CELL_CLASSES = ['flat', 'bti-picker-cell'];

const MODE_ICONS = 'icons';
const MODE_EMOJI = 'emoji';
const MODE_CUSTOM = 'custom';

const RESULTS_GRID = 'grid';
const RESULTS_EMPTY = 'empty';

const SECTION_RECOMMENDED = 'recommended';
const SECTION_SYMBOLIC = 'symbolic';
const SECTION_RECENT = 'recent';
const PACK_SECTION_PREFIX = 'pack:';

const SPACE_CODE = 32;
const SEPARATOR_CODES = Object.freeze([SPACE_CODE, 45, 46, 95]);
const UPPER_A_CODE = 65;
const UPPER_Z_CODE = 90;
const CASE_OFFSET = 32;

const KIND_SYMBOLIC = 'symbolic';
const KIND_COLORED = 'colored';

const _packTextures = new Map();

// The configured panel color can be anything and would vanish in here.
const pickerIconStyle = () => ({tint: prefsForegroundColor()});

// Called at build time, the translation domain is not bound yet when this
// module loads.
const emojiGroups = () => [
    {iconName: 'bti-smile-symbolic', title: _('Smileys & People')},
    {iconName: 'bti-paw-print-symbolic', title: _('Animals & Nature')},
    {iconName: 'bti-apple-symbolic', title: _('Food & Drink')},
    {iconName: 'bti-plane-symbolic', title: _('Travel & Places')},
    {iconName: 'bti-trophy-symbolic', title: _('Activities')},
    {iconName: 'bti-lightbulb-symbolic', title: _('Objects')},
    {iconName: 'bti-hash-symbolic', title: _('Symbols')},
    {iconName: 'bti-flag-symbolic', title: _('Flags')},
];

export default class IconEmojiPicker extends Gtk.Popover {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsIconEmojiPicker'}, this);
    }

    _init({settings, key = null, icons = [], current = null, onSelect = null, showCustom = true, showEmoji = true, showPacks = true}) {
        super._init({css_classes: ['bti-icon-emoji-picker'], has_arrow: false});

        this._settings = settings;
        this._key = key;
        this._recommended = icons;
        this._onSelect = onSelect;
        this._current = current || (key ? settings.get_string(key) : null);
        this._showPacks = showPacks;
        this._columns = MAX_COLUMNS;
        this._isChoosingFile = false;
        this._isClosed = false;

        this._stack = new Gtk.Stack({vexpand: true, vhomogeneous: false, transition_type: Gtk.StackTransitionType.CROSSFADE});
        this._content = createBox({spacing: LAYOUT_GAP_PX});
        this._content.append(this._stack);
        this.set_child(this._content);

        const modes = [{name: MODE_ICONS, iconName: 'bti-image-symbolic', title: _('Icons')}];
        if (showEmoji)
            modes.push({name: MODE_EMOJI, iconName: 'bti-smile-symbolic', title: _('Emojis')});
        if (showCustom)
            modes.push({name: MODE_CUSTOM, iconName: 'bti-folder-search-symbolic', title: _('Custom')});

        // Fetched while the icons show, so the emoji tab opens on parsed data.
        if (showEmoji)
            loadEmojiCatalog();
        this._buildIconsMode();
        if (showCustom)
            this._buildCustomMode();
        this._buildFooter(modes);
        this._showMode(this._initialMode(modes));

        // Finished bytes, not themed icons, so nothing repaints itself. The
        // style manager outlives the picker, so the handler goes on close.
        this._darkId = Adw.StyleManager.get_default().connect('notify::dark', () => {
            this._symbolicGrid.refresh();
            this._coloredGrid?.refresh();
            this._updateCustomPreview?.();
        });
    }

    popupFor(anchor) {
        this.set_parent(anchor);
        this._fitInto(anchor);
        this.connect('closed', () => {
            if (this._isChoosingFile)
                return;
            this._isClosed = true;
            disconnectSignal(this, Adw.StyleManager.get_default(), '_darkId');
            this.unparent();
            for (const grid of [this._symbolicGrid, this._coloredGrid, this._emojiGrid])
                grid?.release();
        });
        this.popup();
    }

    // The popover stays inside the window, so the content shrinks to the room
    // on the roomier side of the anchor and the grid scrolls instead.
    _fitInto(anchor) {
        const root = anchor.get_root();
        const [, bounds] = anchor.compute_bounds(root);
        const roomAbove = bounds.get_y() - WINDOW_MARGIN_PX;
        const roomBelow = root.get_height() - bounds.get_y() - bounds.get_height() - WINDOW_MARGIN_PX;
        this.position = roomBelow >= roomAbove ? Gtk.PositionType.BOTTOM : Gtk.PositionType.TOP;

        const room = Math.max(roomAbove, roomBelow) - POPOVER_CHROME_PX;
        const height = Math.max(POPOVER_MIN_HEIGHT_PX, Math.min(POPOVER_HEIGHT_PX, room));
        const columns = Math.max(MIN_COLUMNS,
            Math.min(MAX_COLUMNS, Math.floor((root.get_width() - 2 * WINDOW_MARGIN_PX) / COLUMN_WIDTH_PX)));
        this._content.set_size_request(columns * COLUMN_WIDTH_PX, height);
        this._columns = columns;
        this._symbolicGrid.setColumns(columns);
        this._coloredGrid?.setColumns(columns);
        this._emojiGrid?.setColumns(columns);
    }

    _initialMode(modes) {
        const hasMode = name => modes.some(mode => mode.name === name);
        if (isEmojiIcon(this._current) && hasMode(MODE_EMOJI))
            return MODE_EMOJI;
        const isPackFile = this._showPacks && isIconPackPath(this._current);
        if (this._current?.startsWith('/') && !isPackFile && hasMode(MODE_CUSTOM))
            return MODE_CUSTOM;
        return MODE_ICONS;
    }

    _buildFooter(modes) {
        this._modeTabs = new Map();
        if (modes.length < 2)
            return;

        const footer = createBox({orientation: 'horizontal', spacing: TAB_GAP_PX, halign: 'center', cssClasses: ['bti-picker-footer']});
        let group = null;
        for (const mode of modes) {
            const tab = _createTab(mode, group);
            group ??= tab;
            tab.connect('clicked', () => this._showMode(mode.name));
            footer.append(tab);
            this._modeTabs.set(mode.name, tab);
        }
        this._content.append(footer);
    }

    _showMode(name) {
        if (name === MODE_EMOJI && !this._emojiGrid)
            this._buildEmojiMode();
        this._stack.visible_child_name = name;
        const tab = this._modeTabs.get(name);
        if (tab)
            tab.active = true;
    }

    // Symbolic and coloured icons are two separate lists behind a switch.
    // The coloured one reads its packs only once it is shown.
    _buildIconsMode() {
        const box = createBox({spacing: LAYOUT_GAP_PX});
        this._iconKinds = new Gtk.Stack({vexpand: true, vhomogeneous: false});
        this._symbolicGrid = this._createIconGrid();

        const sections = [];
        if (this._recommended.length > 0)
            sections.push({id: SECTION_RECOMMENDED, title: _('Recommended'), items: this._recommended.map(_iconItem)});
        sections.push({id: SECTION_SYMBOLIC, title: _('Symbolic Icons'), items: _getSystemIcons().map(_iconItem)});
        this._symbolicGrid.setSections(sections);
        this._symbolicGrid.scrollToValue(this._current);
        this._iconKinds.add_named(this._symbolicGrid.widget, KIND_SYMBOLIC);

        if (this._showPacks) {
            const kinds = new Adw.ToggleGroup({halign: Gtk.Align.CENTER});
            kinds.add(new Adw.Toggle({name: KIND_SYMBOLIC, label: _('Symbolic')}));
            kinds.add(new Adw.Toggle({name: KIND_COLORED, label: _('Colored')}));
            kinds.update_property([Gtk.AccessibleProperty.LABEL], [_('Icon kind')]);
            kinds.connect('notify::active-name', () => this._showIconKind(kinds.active_name));
            kinds.active_name = isIconPackPath(this._current) ? KIND_COLORED : KIND_SYMBOLIC;
            box.append(kinds);
        }
        box.append(this._iconKinds);
        this._stack.add_named(box, MODE_ICONS);
    }

    _createIconGrid() {
        return new SectionGrid({
            kind: MODE_ICONS,
            settings: this._settings,
            current: this._current,
            columns: this._columns,
            onPick: (item, section) => this._pick(section.pack ? _packIconValue(section.pack, item) : item.value),
            searchPlaceholder: _('Search icons…'),
            emptyTitle: _('No Icons Found'),
            showTabs: false,
        });
    }

    _showIconKind(kind) {
        if (kind === KIND_COLORED && !this._coloredGrid)
            this._buildColoredGrid();
        this._iconKinds.visible_child_name = kind;
    }

    // The active theme's pack comes first, the others follow one at a time
    // as their names arrive. Each lands at the end of the list.
    _buildColoredGrid() {
        this._coloredGrid = this._createIconGrid();
        this._coloredGrid.setSections([]);
        this._iconKinds.add_named(this._coloredGrid.widget, KIND_COLORED);
        listIconPacks()
            .then(packs => this._appendPacks(packs))
            .catch(e => error('Icon packs failed to load', e));
    }

    async _appendPacks([pack, ...rest]) {
        if (!pack || this._isClosed)
            return;
        await loadPackIcons(pack);
        if (this._isClosed)
            return;
        if (pack.names.length > 0) {
            this._coloredGrid.addSections([_packSection(pack)]);
            this._coloredGrid.scrollToValue(this._current);
        }
        await this._appendPacks(rest);
    }

    _buildEmojiMode() {
        this._emojiGrid = new SectionGrid({
            kind: MODE_EMOJI,
            settings: this._settings,
            current: this._current,
            columns: this._columns,
            onPick: item => this._pick(item.value),
            searchPlaceholder: _('Search emojis…'),
            emptyTitle: _('No Emojis Found'),
        });
        this._stack.add_named(this._emojiGrid.widget, MODE_EMOJI);

        loadEmojiCatalog().then(catalog => {
            const groups = emojiGroups();
            const sections = groups.map((group, index) => ({id: String(index), ...group, items: []}));
            for (const emoji of catalog)
                sections[emoji.group].items.push(emoji);

            const byValue = new Map(catalog.map(emoji => [emoji.value, emoji]));
            const recent = this._settings.get_strv(RECENT_EMOJIS_KEY)
                .map(hex => byValue.get(`${EMOJI_ICON_PREFIX}${hex}`))
                .filter(Boolean);
            sections.unshift({id: SECTION_RECENT, iconName: 'bti-clock-symbolic', title: _('Recent'), items: recent});

            this._emojiGrid.setSections(sections);
            this._emojiGrid.scrollToValue(this._current);
        }).catch(e => error('Emoji catalog failed to load', e));
    }

    _buildCustomMode() {
        const box = createBox({spacing: CUSTOM_GAP_PX, valign: 'center', cssClasses: ['bti-picker-custom']});
        box.append(createLabel(_('Type a name or pick an SVG/PNG file.'), ['dimmed'], {wrap: true}));

        const previewImage = createImage({pixel_size: PREVIEW_ICON_SIZE_PX, halign: 'center'});
        const entry = new Gtk.Entry({
            placeholder_text: _('Icon name or path'),
            hexpand: true,
            valign: Gtk.Align.CENTER,
            text: this._current && !isEmojiIcon(this._current) ? this._current : '',
        });

        this._updateCustomPreview = () =>
            applyPathIcon(previewImage, entry.text.trim(), this._settings, pickerIconStyle());
        entry.connect('changed', this._updateCustomPreview);
        this._updateCustomPreview();

        const finishSelection = () => {
            const value = entry.text.trim();
            if (value)
                this._pick(value);
        };
        entry.connect('activate', finishSelection);

        const fileButton = createIconButton('bti-folder-symbolic', {
            flat: false,
            circular: false,
            tooltip: _('Choose file'),
            onClick: () => this._openFileChooser(entry),
        });
        const applyButton = createIconButton('bti-select-symbolic', {
            flat: false,
            extraClasses: ['suggested-action'],
            tooltip: _('Apply'),
            onClick: finishSelection,
        });

        const inputRow = createBox({orientation: 'horizontal', spacing: CUSTOM_GAP_PX});
        inputRow.append(entry);
        inputRow.append(fileButton);
        inputRow.append(applyButton);

        box.prepend(previewImage);
        box.append(inputRow);
        this._stack.add_named(box, MODE_CUSTOM);
    }

    _openFileChooser(entryWidget) {
        const filter = createFileFilter(_('Image Files'), [], ['image/svg+xml', 'image/png']);
        const root = this.get_parent().get_root();
        const reopen = () => {
            this._isChoosingFile = false;
            this.popup();
        };
        // The chooser is modal to the window and an open popover would sit
        // above it, so the popover steps aside and comes back either way.
        this._isChoosingFile = true;
        this.popdown();
        openFileChooser(root, {
            title: _('Select Image'),
            filters: [filter],
            onDismiss: reopen,
        }, path => {
            entryWidget.set_text(path);
            reopen();
        });
    }

    _pick(value) {
        if (isEmojiIcon(value))
            this._rememberEmoji(value.slice(EMOJI_ICON_PREFIX.length));
        if (this._onSelect)
            this._onSelect(value);
        else if (this._key)
            this._settings.set_string(this._key, value);
        this.popdown();
    }

    _rememberEmoji(hex) {
        const recent = this._settings.get_strv(RECENT_EMOJIS_KEY).filter(entry => entry !== hex);
        this._settings.set_strv(RECENT_EMOJIS_KEY, [hex, ...recent].slice(0, RECENT_EMOJIS_MAX));
    }
}

// A section title takes the first cell of its own row and fillers pad every
// row, so each section starts on a whole row of the grid. Cells are never
// stored, a position maps to its section and index by arithmetic.
class SectionGrid {
    constructor({kind, settings, current, columns, onPick, searchPlaceholder, emptyTitle, showTabs = true}) {
        this._kind = kind;
        this._settings = settings;
        this._current = current;
        this._onPick = onPick;
        this._sections = [];
        this._tabs = new Map();
        this._query = '';
        this._pendingRow = null;
        this._hasUserScrolled = false;
        this._packLoads = new Map();
        this._packIcons = new Map();
        this._namedIcons = new Map();
        this._packLoadsInFlight = 0;
        this._iconTickId = 0;
        this._lastScrollUs = 0;

        this.widget = createBox({spacing: LAYOUT_GAP_PX});
        this._showTabs = showTabs;
        this._tabBar = createBox({orientation: 'horizontal', spacing: TAB_GAP_PX, homogeneous: true, hexpand: true, visible: showTabs});
        // A plain entry with the bundled glyph, Gtk.SearchEntry draws the
        // theme's edit-find icon and some themes rotate or restyle it
        this._searchEntry = new Gtk.Entry({
            placeholder_text: searchPlaceholder,
            primary_icon_gicon: bundledOrThemedIcon(SEARCH_ICON_NAME),
            primary_icon_activatable: false,
        });
        this._searchEntry.connect('changed', entry => {
            this._query = entry.text.trim().toLowerCase();
            this._rebuild();
            // A new model keeps the old offset, the results start at the top
            if (this._model.get_n_items() > 0)
                this._grid.scroll_to(0, Gtk.ListScrollFlags.NONE, null);
        });

        // A change to the model the grid shows makes GTK fetch every added
        // position to reuse widgets, a frame or more for a big list. So each
        // search fills the model the grid does not show and the grid swaps.
        this._fullModel = new CellModel(columns);
        this._searchModels = [new CellModel(columns), new CellModel(columns)];
        this._fullSelection = new Gtk.NoSelection({model: this._fullModel});
        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_factory, listItem) => listItem.set_child(this._createCellWidget()));
        factory.connect('bind', (_factory, listItem) => this._bindCell(listItem));
        this._grid = new Gtk.GridView({
            model: this._fullSelection,
            factory,
            min_columns: columns,
            max_columns: columns,
            css_classes: ['bti-picker-grid'],
        });
        this._scroller = new Gtk.ScrolledWindow({
            child: this._grid,
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        });
        const adjustment = this._scroller.get_vadjustment();
        adjustment.connect('value-changed', () => {
            this._lastScrollUs = GLib.get_monotonic_time();
            this._syncToScroll();
        });
        adjustment.connect('changed', () => {
            this._applyPendingRow();
            this._syncToScroll();
        });
        const wheel = new Gtk.EventControllerScroll({flags: Gtk.EventControllerScrollFlags.VERTICAL});
        wheel.connect('scroll', () => {
            this._hasUserScrolled = true;
            return false;
        });
        this._scroller.add_controller(wheel);

        this._results = new Gtk.Stack({vhomogeneous: false});
        this._results.add_named(this._scroller, RESULTS_GRID);
        this._results.add_named(new Adw.StatusPage({
            icon_name: SEARCH_ICON_NAME,
            title: emptyTitle,
            description: _('Try a different search term.'),
            css_classes: ['compact'],
        }), RESULTS_EMPTY);

        this.widget.append(this._tabBar);
        this.widget.append(this._searchEntry);
        this.widget.append(this._results);
    }

    setSections(sections) {
        this._sections = [];
        this.addSections(sections);
    }

    // Sections land at the end, so the rows above keep their place and a
    // view the user scrolled stays where it is.
    addSections(sections) {
        for (const section of sections) {
            this._sections.push(section);
            if (!this._showTabs)
                continue;
            const tab = _createTab(section, this._tabs.values().next().value ?? null);
            tab.connect('clicked', () => this.scrollToRow(this._model.sectionRow(section) ?? 0));
            this._tabBar.append(tab);
            this._tabs.set(section.id, tab);
            tab.visible = _sectionCount(section) > 0;
        }
        this._fullModel.append(sections.map(section => ({section, matches: null})));
        if (this._query)
            this._rebuild();
        this._syncResults();
    }

    get _model() {
        return this._grid.model.model;
    }

    setColumns(columns) {
        if (columns === this._fullModel.columns)
            return;
        this._grid.min_columns = columns;
        this._grid.max_columns = columns;
        this._fullModel.setColumns(columns);
        this._searchModels.forEach(model => model.setColumns(columns));
    }

    refresh() {
        this._model.items_changed(0, this._model.get_n_items(), this._model.get_n_items());
    }

    // One row of context stays above the current item. Only before the user
    // scrolls, a late section must not pull the view away from them.
    scrollToValue(value) {
        if (this._hasUserScrolled)
            return;
        const position = this._model.positionOf(value);
        if (position !== null)
            this.scrollToRow(Math.max(0, Math.floor(position / this._model.columns) - 1));
    }

    // Before the first layout the adjustment has no range yet, so the row
    // waits for the 'changed' that brings one.
    scrollToRow(row) {
        this._pendingRow = row;
        this._applyPendingRow();
    }

    // An offset set while the grid allocates leaves its cells unbuilt, so the
    // jump lands on the next frame.
    _applyPendingRow() {
        const adjustment = this._scroller.get_vadjustment();
        if (this._pendingRow === null || adjustment.page_size === 0)
            return;
        const offset = this._pendingRow * ROW_HEIGHT_PX;
        this._pendingRow = null;
        this._grid.add_tick_callback(() => {
            adjustment.value = offset;
            return GLib.SOURCE_REMOVE;
        });
    }

    // Words match from their start, so cat skips communication and an
    // icon's dashes count as word breaks.
    _rebuild() {
        const needle = ` ${this._query}`;
        const segments = this._sections.map(section => ({
            section,
            matches: this._query ? _sectionMatches(section, needle) : null,
        }));
        for (const {section, matches} of segments)
            this._tabs.get(section.id)?.set_sensitive((matches?.length ?? _sectionCount(section)) > 0);
        if (!this._query) {
            this._grid.model = this._fullSelection;
            this._syncResults();
            return;
        }
        const hidden = this._searchModels.find(model => model !== this._model);
        hidden.replace(segments);
        this._grid.model = new Gtk.NoSelection({model: hidden});
        this._syncResults();
    }

    _syncResults() {
        this._results.visible_child_name = this._model.get_n_items() > 0 ? RESULTS_GRID : RESULTS_EMPTY;
        this._syncToScroll();
    }

    // The active tab is the section whose title last passed the top edge.
    _syncToScroll() {
        const rows = this._model.get_n_items() / this._model.columns;
        if (rows === 0)
            return;
        const adjustment = this._scroller.get_vadjustment();
        const isAtEnd = adjustment.value >= adjustment.upper - adjustment.page_size - 1;
        const topRow = Math.floor(adjustment.value / ROW_HEIGHT_PX);
        const row = isAtEnd ? rows - 1 : Math.min(topRow, rows - 1);
        const section = this._model.sectionAt(row * this._model.columns);
        const tab = section ? this._tabs.get(section.id) : null;
        if (tab && !tab.active)
            tab.active = true;
    }

    _createCellWidget() {
        const content = this._kind === MODE_EMOJI
            ? createLabel('', ['bti-picker-emoji'])
            : createImage({
                pixel_size: GRID_ICON_SIZE_PX,
                width_request: GRID_ICON_SIZE_PX,
                height_request: GRID_ICON_SIZE_PX,
            });
        // The button is the whole cell, a wrapper box per cell doubled what a
        // freshly opened grid has to build in one frame.
        const button = new Gtk.Button({
            child: content,
            width_request: CELL_SIZE_PX,
            height_request: CELL_SIZE_PX,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            margin_top: CELL_MARGIN_PX,
            margin_bottom: CELL_MARGIN_PX,
            overflow: Gtk.Overflow.VISIBLE,
            css_classes: CELL_CLASSES,
        });
        button.connect('clicked', () => this._onPick(button._btiItem, button._btiSection));
        button._btiContent = content;
        return button;
    }

    _bindCell(listItem) {
        const button = listItem.get_child();
        const {section, index} = listItem.get_item();
        listItem.focusable = false;
        if (index === CELL_TITLE) {
            this._showTitle(button, section.title);
            return;
        }
        const item = index >= 0 ? _sectionItem(section, index) : null;
        button.set_child(button._btiContent);
        button.visible = item !== null;
        if (item === null)
            return;

        button.can_target = true;
        button._btiItem = item;
        button._btiSection = section;
        button.tooltip_text = item.name;
        button.update_property([Gtk.AccessibleProperty.LABEL], [item.name]);
        button.set_css_classes(item.value === this._current ? CURRENT_CELL_CLASSES : CELL_CLASSES);

        const content = button._btiContent;
        if (this._kind === MODE_EMOJI)
            content.label = item.text;
        else if (section.pack)
            this._queuePackIcon(content, item.value);
        else
            this._queueNamedIcon(content, item.value);
    }

    // Only a row's first cell ever holds a title, so its label is made on
    // first use and the cell turns into plain text.
    _showTitle(button, title) {
        button._btiTitle ??= new SectionTitle();
        button._btiTitle.label = title;
        button.set_child(button._btiTitle);
        button.set_css_classes(TITLE_CELL_CLASSES);
        button.can_target = false;
        button.visible = true;
        button._btiItem = null;
    }

    // The theme draws a symbolic icon in the label color itself, but parses
    // its SVG on the main loop when first drawn, so a fresh screen of them
    // is handed over a few per frame too.
    _queueNamedIcon(image, name) {
        this._forgetQueued(image);
        image.clear();
        this._namedIcons.set(image, name);
        this._iconTickId ||= this._grid.add_tick_callback(() => this._runIconQueue());
    }

    // GTK would decode a file icon on the main loop when first drawn. These
    // decode asynchronously, a few per frame once scrolling pauses, so a
    // flick starts no loads and a rebound cell cancels its own.
    _queuePackIcon(image, path) {
        this._forgetQueued(image);
        const cached = _packTextures.get(path);
        if (cached) {
            image.set_from_paintable(cached);
            return;
        }
        image.clear();
        this._packLoads.set(image, path);
        this._iconTickId ||= this._grid.add_tick_callback(() => this._runIconQueue());
    }

    _forgetQueued(image) {
        image._btiPackLoad?.cancel();
        image._btiPackLoad = null;
        this._packLoads.delete(image);
        this._packIcons.delete(image);
        this._namedIcons.delete(image);
    }

    _runIconQueue() {
        const isScrolling = GLib.get_monotonic_time() - this._lastScrollUs < SCROLL_SETTLE_US;
        const loadBudget = isScrolling ? 0 : PACK_LOADS_PER_FRAME;
        let started = 0;
        for (const [image, path] of this._packLoads) {
            if (started++ >= loadBudget)
                break;
            this._packLoads.delete(image);
            this._loadPackIcon(image, path);
        }
        let shown = 0;
        for (const [image, texture] of this._packIcons) {
            if (shown++ === ICONS_PER_FRAME)
                break;
            image.set_from_paintable(texture);
            this._packIcons.delete(image);
        }
        for (const [image, name] of this._namedIcons) {
            if (shown++ >= ICONS_PER_FRAME)
                break;
            image.set_from_icon_name(name);
            this._namedIcons.delete(image);
        }
        const isIdle = this._packLoads.size === 0 && this._packIcons.size === 0 &&
            this._namedIcons.size === 0 && this._packLoadsInFlight === 0;
        if (!isIdle)
            return GLib.SOURCE_CONTINUE;
        this._iconTickId = 0;
        return GLib.SOURCE_REMOVE;
    }

    _loadPackIcon(image, path) {
        const cancellable = new Gio.Cancellable();
        image._btiPackLoad = cancellable;
        this._packLoadsInFlight++;
        readIconTexture(path, GRID_ICON_SIZE_PX * image.get_scale_factor(), cancellable)
            .then(texture => {
                if (_packTextures.size >= PACK_TEXTURE_CACHE_MAX)
                    _packTextures.delete(_packTextures.keys().next().value);
                _packTextures.set(path, texture);
                if (image._btiPackLoad === cancellable)
                    this._packIcons.set(image, texture);
            })
            .catch(() => {})
            .finally(() => this._packLoadsInFlight--);
    }

    // A closed grid lets go of its cells and their pictures right away,
    // the frame clock no longer ticks to finish its queue.
    release() {
        if (this._iconTickId)
            this._grid.remove_tick_callback(this._iconTickId);
        this._iconTickId = 0;
        this._packLoads.forEach((_path, image) => this._forgetQueued(image));
        this._grid.model = null;
    }
}

// One entry per section with its search matches, a GObject only for a
// position the grid asks for. Tens of thousands of stored cells made every
// garbage collection pause the scrolling.
const CellModel = GObject.registerClass({
    GTypeName: 'BetterTrayIconsPickerCellModel',
    Implements: [Gio.ListModel],
}, class CellModel extends GObject.Object {
    _init(columns) {
        super._init();
        this.columns = columns;
        this._segments = [];
        this._length = 0;
        this._cells = new Map();
    }

    replace(segments) {
        const removed = this._length;
        this._segments = [];
        this._length = 0;
        this._cells.clear();
        this._layout(segments);
        this.items_changed(0, removed, this._length);
    }

    append(segments) {
        const start = this._length;
        this._layout(segments);
        this.items_changed(start, 0, this._length - start);
    }

    setColumns(columns) {
        this.columns = columns;
        this.replace(this._segments.map(({section, matches}) => ({section, matches})));
    }

    _layout(segments) {
        for (const {section, matches} of segments) {
            const count = matches?.length ?? _sectionCount(section);
            if (count === 0)
                continue;
            const rows = 1 + Math.ceil(count / this.columns);
            this._segments.push({section, matches, count, start: this._length});
            this._length += rows * this.columns;
        }
    }

    _segmentAt(position) {
        let low = 0;
        let high = this._segments.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (this._segments[middle].start <= position)
                low = middle;
            else
                high = middle - 1;
        }
        return this._segments[low] ?? null;
    }

    sectionAt(position) {
        return this._segmentAt(position)?.section ?? null;
    }

    sectionRow(section) {
        const segment = this._segments.find(entry => entry.section === section);
        return segment ? segment.start / this.columns : null;
    }

    positionOf(value) {
        for (const segment of this._segments) {
            const index = _sectionIndexOf(segment.section, value);
            const local = segment.matches ? segment.matches.indexOf(index) : index;
            if (index !== -1 && local !== -1)
                return segment.start + this.columns + local;
        }
        return null;
    }

    vfunc_get_item_type() {
        return PickerCell.$gtype;
    }

    vfunc_get_n_items() {
        return this._length;
    }

    vfunc_get_item(position) {
        const segment = position < this._length ? this._segmentAt(position) : null;
        if (!segment)
            return null;
        const local = position - segment.start;
        if (local < this.columns)
            return this._cellAt(position, segment.section, local === 0 ? CELL_TITLE : CELL_FILLER);
        const slot = local - this.columns;
        if (slot >= segment.count)
            return this._cellAt(position, segment.section, CELL_FILLER);
        return this._cellAt(position, segment.section, segment.matches ? segment.matches[slot] : slot);
    }

    // A full scroll asks for every position once. Cells are recycled from the
    // least recently asked position, the grid holds far fewer than the pool,
    // so a scroll through a big pack leaves no trail of objects to collect.
    _cellAt(position, section, index) {
        let cell = this._cells.get(position);
        this._cells.delete(position);
        if (!cell && this._cells.size >= CELL_POOL_SIZE) {
            const [oldest] = this._cells.keys();
            cell = this._cells.get(oldest);
            this._cells.delete(oldest);
        }
        cell ??= new PickerCell(section, index);
        cell.section = section;
        cell.index = index;
        this._cells.set(position, cell);
        return cell;
    }
});

const PickerCell = GObject.registerClass({
    GTypeName: 'BetterTrayIconsPickerCell',
}, class PickerCell extends GObject.Object {
    _init(section, index) {
        super._init();
        this.section = section;
        this.index = index;
    }
});

// A title lives in one grid cell but reads across its whole row. It asks for
// no width, so the column stays as wide as an icon, and draws past its edge
// over the empty cells beside it, inset to line up with the centered buttons.
const SectionTitle = GObject.registerClass({
    GTypeName: 'BetterTrayIconsPickerSectionTitle',
}, class SectionTitle extends Gtk.Label {
    _init() {
        super._init({
            css_classes: ['heading'],
            xalign: 0,
            hexpand: true,
            vexpand: true,
            valign: Gtk.Align.END,
            margin_bottom: TITLE_BOTTOM_GAP_PX,
        });
    }

    vfunc_measure(orientation, forSize) {
        if (orientation === Gtk.Orientation.HORIZONTAL)
            return [0, 0, -1, -1];
        return super.vfunc_measure(orientation, forSize);
    }

    vfunc_snapshot(snapshot) {
        const inset = Math.max(0, (this.get_width() - CELL_SIZE_PX) / 2);
        snapshot.translate(new Graphene.Point({x: inset, y: 0}));
        super.vfunc_snapshot(snapshot);
    }
});

function _createTab({title, iconName}, group) {
    const tab = new Gtk.ToggleButton({
        icon_name: iconName,
        tooltip_text: title,
        css_classes: ['flat', 'bti-picker-tab'],
        group,
    });
    tab.update_property([Gtk.AccessibleProperty.LABEL], [title]);
    return tab;
}

function _iconItem(name) {
    return {value: name, name, search: ` ${name.replace(/[-_.]/g, ' ')}`.toLowerCase()};
}

let _systemIconsCache = null;

let _isThemeWatched = false;

function _getSystemIcons() {
    if (_systemIconsCache)
        return _systemIconsCache;

    const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    if (!_isThemeWatched) {
        _isThemeWatched = true;
        iconTheme.connect('changed', () => (_systemIconsCache = null));
    }

    const filtered = iconTheme.get_icon_names().filter(name => {
        if (!name.endsWith('-symbolic'))
            return false;
        return !name.includes('night') && !name.includes('rtl') && !name.startsWith('adw-');
    });

    _systemIconsCache = [...new Set(filtered)].sort();
    return _systemIconsCache;
}

// A name keeps syncing between machines, so it is stored whenever the active
// theme resolves it to this same pack. Anything else stores the file path,
// which the shell draws as a file icon.
function _packIconValue(pack, item) {
    const resolved = themeIconFile(item.name);
    const isInsidePack = !!resolved && pack.dirs.some(dir => resolved.startsWith(`${dir}/`));
    return isInsidePack ? item.name : item.value;
}

function _packSection(pack) {
    return {
        id: `${PACK_SECTION_PREFIX}${pack.id}`,
        title: pack.name,
        pack,
    };
}

// Small sections keep one object per item. A pack keeps two string arrays,
// and an item object exists only while its cell is on screen.
function _sectionCount(section) {
    return section.items?.length ?? section.pack.names.length;
}

function _sectionItem(section, index) {
    if (section.items)
        return section.items[index];
    return {value: packIconPath(section.pack, index), name: section.pack.names[index]};
}

function _sectionIndexOf(section, value) {
    if (section.items)
        return section.items.findIndex(item => item.value === value);
    return typeof value === 'string' ? packIconIndex(section.pack, value) : -1;
}

function _sectionMatches(section, needle) {
    const matches = [];
    if (section.items) {
        section.items.forEach((item, index) => {
            if (item.search.includes(needle))
                matches.push(index);
        });
        return matches;
    }
    const codes = [...needle.slice(1)].map(char => char.charCodeAt(0));
    section.pack.names.forEach((name, index) => {
        if (_isWordStartMatch(name, codes))
            matches.push(index);
    });
    return matches;
}

// The same word-start rule as the search strings of the small sections,
// compared code by code so a keystroke over a big pack allocates nothing.
function _isWordStartMatch(name, codes) {
    for (let start = 0; start <= name.length - codes.length; start++) {
        const isWordStart = start === 0 || _isSeparator(name.charCodeAt(start - 1));
        if (isWordStart && _matchesAt(name, start, codes))
            return true;
    }
    return false;
}

function _matchesAt(name, start, codes) {
    for (let i = 0; i < codes.length; i++) {
        const code = _foldCase(name.charCodeAt(start + i));
        const isSame = code === codes[i] || (codes[i] === SPACE_CODE && _isSeparator(code));
        if (!isSame)
            return false;
    }
    return true;
}

function _isSeparator(code) {
    return SEPARATOR_CODES.includes(code);
}

function _foldCase(code) {
    return code >= UPPER_A_CODE && code <= UPPER_Z_CODE ? code + CASE_OFFSET : code;
}
