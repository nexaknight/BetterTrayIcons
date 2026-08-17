import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {clearIds, connectScoped, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {createBox, createButton, createIconButton, createImage, createLabel, createFileFilter, applyPathIcon, applyTintedIcon, clearChildren, prefsForegroundColor} from '../widgets/gtkHelpers.js';
import {openFileChooser} from './dialogs.js';
import {NEXT_ICON_NAME} from '../widgets/rows.js';

// Slower to allow multi-digit input.
const PAGE_JUMP_DEBOUNCE_MS = 500;
const ITEMS_PER_PAGE = 32;

// The configured panel color can be anything and would vanish against the dialog.
const pickerIconStyle = () => ({tint: prefsForegroundColor()});

export default class IconPickerDialog extends Adw.PreferencesDialog {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsIconPickerWidget'}, this);
    }

    _init(settings, settingsKey, iconList, onSelectCallback = null, initialIcon = null, options = {}) {
        super._init({
            title: _('Select Icon'),
            content_width: 720,
            content_height: 720,
        });

        this._settings = settings;
        this._key = settingsKey;
        this._iconList = iconList;
        this._onSelectCallback = onSelectCallback;
        this._showCustom = options.showCustom !== false;

        this._currentIcon = initialIcon;
        if (!this._currentIcon && this._key)
            this._currentIcon = this._settings.get_string(this._key);

        this._allSystemIcons = [];
        this._currentFilteredList = [];
        this._currentPage = 0;
        this._itemsPerPage = ITEMS_PER_PAGE;
        this._inputTimeoutId = 0;

        // Both grids can show the current icon, so a click has to clear the
        // other grid's highlight too.
        this._activeGridBtns = new Set();

        this._buildUI();
    }

    _buildUI() {
        if (this._iconList.length > 0) {
            const pageRec = new Adw.PreferencesPage({
                title: _('Recommended'),
                icon_name: 'bti-star-symbolic',
                name: 'recommended',
            });
            this._recommendedGroup = new Adw.PreferencesGroup();
            pageRec.add(this._recommendedGroup);
            this._fillRecommendedGrid();
            this.add(pageRec);
        }

        this._allSystemIcons = _getSystemIcons();
        this._currentFilteredList = this._allSystemIcons;
        this._buildAllIconsPage();

        if (this._showCustom)
            this._buildCustomPage();

        this._setInitialTab();

        // Finished bytes, not themed icons, so nothing repaints itself.
        connectScoped(this, Adw.StyleManager.get_default(), 'notify::dark',
            () => this._retintIcons());
    }

    _fillRecommendedGrid() {
        if (this._recommendedGrid)
            this._recommendedGroup.remove(this._recommendedGrid);
        this._recommendedGrid = this._createGrid(this._iconList);
        this._recommendedGroup.add(this._recommendedGrid);
    }

    _buildAllIconsPage() {
        const pageAll = new Adw.PreferencesPage({
            title: _('All Icons'),
            icon_name: 'bti-grid-symbolic',
            name: 'all',
        });

        const groupSearch = new Adw.PreferencesGroup();
        pageAll.add(groupSearch);

        const searchEntry = new Gtk.SearchEntry({
            placeholder_text: _('Search icons…'),
            hexpand: true,
            margin_top: 12, margin_bottom: 0,
            margin_start: 12, margin_end: 12,
        });
        groupSearch.add(searchEntry);

        this._resultsGroup = new Adw.PreferencesGroup({title: _('System Icons')});
        pageAll.add(this._resultsGroup);

        this._allIconsGridContainer = createBox({halign: 'fill'});
        this._resultsGroup.add(this._allIconsGridContainer);

        this._paginationGroup = new Adw.PreferencesGroup();
        pageAll.add(this._paginationGroup);

        const paginationBox = createBox({
            orientation: 'horizontal', halign: 'center', spacing: 12,
            margin_top: 6, margin_bottom: 12,
        });
        this._paginationGroup.add(paginationBox);

        this._prevPageBtn = createIconButton('bti-previous-symbolic', {tooltip_text: _('Previous')});

        this._pageEntry = new Gtk.Entry({
            width_chars: 4,
            max_length: 4,
            xalign: 0.5,
            valign: Gtk.Align.CENTER,
            input_purpose: Gtk.InputPurpose.DIGITS,
        });

        this._totalPageLabel = createLabel('/ 1', ['dim-label']);

        this._nextPageBtn = createIconButton(NEXT_ICON_NAME, {tooltip_text: _('Next')});

        paginationBox.append(this._prevPageBtn);
        paginationBox.append(this._pageEntry);
        paginationBox.append(this._totalPageLabel);
        paginationBox.append(this._nextPageBtn);

        this._setupPaginationEvents(searchEntry);
        this._renderAllIconsPage();
        this.add(pageAll);
    }

    _buildCustomPage() {
        const pageCustom = new Adw.PreferencesPage({
            title: _('Custom'),
            icon_name: 'bti-properties-symbolic',
            name: 'custom',
        });
        const groupCustom = new Adw.PreferencesGroup({
            title: _('Custom Icon'),
            description: _('Type a name or pick an SVG/PNG file.'),
        });
        pageCustom.add(groupCustom);

        const previewImg = createImage({pixel_size: 64, halign: 'center', margin_top: 16});

        const entry = new Gtk.Entry({
            placeholder_text: _('Icon name or path'),
            hexpand: true,
            valign: Gtk.Align.CENTER,
            text: this._currentIcon || '',
        });

        this._updateCustomPreview = () =>
            applyPathIcon(previewImg, entry.text.trim(), this._settings, pickerIconStyle());
        entry.connect('changed', this._updateCustomPreview);
        this._updateCustomPreview();

        const finishSelection = () => {
            const value = entry.text.trim();
            if (!value)
                return;
            if (this._onSelectCallback)
                this._onSelectCallback(value);
            else if (this._key)
                this._settings.set_string(this._key, value);
            this.close();
        };

        entry.connect('activate', finishSelection);

        const customBox = createBox({
            orientation: 'horizontal', spacing: 12,
            margin_top: 12, margin_bottom: 12,
            margin_start: 12, margin_end: 12,
        });

        const fileBtn = createIconButton('bti-folder-symbolic', {
            flat: false,
            circular: false,
            tooltip_text: _('Choose file'),
        });
        fileBtn.connect('clicked', () => this._openFileChooser(entry));

        const applyBtn = createIconButton('bti-select-symbolic', {
            flat: false,
            extraClasses: ['suggested-action'],
            tooltip_text: _('Apply'),
        });
        applyBtn.connect('clicked', finishSelection);

        customBox.append(entry);
        customBox.append(fileBtn);
        customBox.append(applyBtn);

        const wrapper = createBox();
        wrapper.append(previewImg);
        wrapper.append(customBox);
        groupCustom.add(wrapper);

        this.add(pageCustom);
    }

    _setInitialTab() {
        this.connect('notify::visible-page-name', () => this._showPageWithCurrentIcon());

        if (this._currentIcon && !this._iconList.includes(this._currentIcon))
            this.set_visible_page_name('all');

        // Without a recommended list the dialog already sits on 'all', so no
        // notify fires.
        this._showPageWithCurrentIcon();
    }

    // _currentFilteredList, not _allSystemIcons, so the page is right while a
    // search filter is active.
    _showPageWithCurrentIcon() {
        if (this.visible_page_name !== 'all' || !this._currentIcon)
            return;
        const index = this._currentFilteredList.indexOf(this._currentIcon);
        if (index === -1)
            return;
        const page = Math.floor(index / this._itemsPerPage);
        if (page === this._currentPage)
            return;
        this._currentPage = page;
        this._renderAllIconsPage();
    }

    _retintIcons() {
        if (this._recommendedGroup)
            this._fillRecommendedGrid();
        this._renderAllIconsPage();
        this._updateCustomPreview?.();
    }

    _setupPaginationEvents(searchEntry) {
        this._prevPageBtn.connect('clicked', () => {
            if (this._currentPage > 0) {
                this._currentPage--;
                this._renderAllIconsPage();
            }
        });

        this._nextPageBtn.connect('clicked', () => {
            const totalPages = Math.ceil(this._currentFilteredList.length / this._itemsPerPage);
            if (this._currentPage < totalPages - 1) {
                this._currentPage++;
                this._renderAllIconsPage();
            }
        });

        searchEntry.connect('search-changed', entry => {
            const lower = entry.text.toLowerCase();
            if (lower.length === 0) {
                this._currentFilteredList = this._allSystemIcons;
            } else {
                this._currentFilteredList = this._allSystemIcons.filter(name =>
                    name.toLowerCase().includes(lower)
                );
            }
            this._currentPage = 0;
            this._renderAllIconsPage();
        });

        this._pageEntry.connect('changed', entry => {
            debounceTo(this, '_inputTimeoutId', PAGE_JUMP_DEBOUNCE_MS, () => {
                if (this.get_root())
                    this._jumpToPage(entry);
            });
        });
    }

    _jumpToPage(inputEntry) {
        const val = parseInt(inputEntry.text);
        const totalPages = Math.ceil(this._currentFilteredList.length / this._itemsPerPage) || 1;

        // _updatePaginationUI sets the entry text via set_text, which fires 'changed'.
        // Skip those redundant re-renders.
        if (!isNaN(val) && val >= 1 && val <= totalPages && val - 1 !== this._currentPage) {
            this._currentPage = val - 1;
            this._renderAllIconsPage();
        }
    }

    _renderAllIconsPage() {
        clearChildren(this._allIconsGridContainer);

        // Buttons from discarded page renders would otherwise pile up
        // and get restyled on every click.
        for (const btn of this._activeGridBtns) {
            if (!btn.get_root())
                this._activeGridBtns.delete(btn);
        }

        if (this._currentFilteredList.length === 0) {
            const status = new Adw.StatusPage({
                icon_name: 'bti-search-symbolic',
                title: _('No Icons Found'),
                description: _('Try a different search term.'),
            });
            this._allIconsGridContainer.append(status);
            this._resultsGroup.title = '';
            this._paginationGroup.visible = false;
            this._updatePaginationUI();
            return;
        }

        this._resultsGroup.title = _('System Icons');
        this._paginationGroup.visible = true;

        const start = this._currentPage * this._itemsPerPage;
        const end = start + this._itemsPerPage;
        const pageItems = this._currentFilteredList.slice(start, end);

        const grid = this._createGridWidget(pageItems);
        this._allIconsGridContainer.append(grid);

        this._updatePaginationUI();
    }

    _updatePaginationUI() {
        const totalItems = this._currentFilteredList.length;
        const totalPages = Math.ceil(totalItems / this._itemsPerPage) || 1;

        _setVisibleButton(this._prevPageBtn, this._currentPage > 0);
        _setVisibleButton(this._nextPageBtn, this._currentPage < totalPages - 1);

        const pageStr = (this._currentPage + 1).toString();
        if (this._pageEntry.text !== pageStr && !this._pageEntry.has_focus)
            this._pageEntry.set_text(pageStr);

        this._totalPageLabel.set_label(`/ ${totalPages}`);
    }

    _createGridWidget(iconList) {
        const grid = new Gtk.Grid({
            column_spacing: 8, row_spacing: 8,
            halign: Gtk.Align.FILL, hexpand: true,
            margin_top: 8, margin_bottom: 8,
            margin_start: 8, margin_end: 8,
        });

        const COLUMNS = 8;
        const style = pickerIconStyle();

        iconList.forEach((iconName, index) => {
            const isCurrent = this._currentIcon === iconName;
            const btn = createButton({
                valign: 'fill',
                height_request: 56,
                hexpand: true,
                tooltip_text: iconName,
                cssClasses: isCurrent ? ['suggested-action', 'circular'] : ['flat', 'circular'],
            });

            const img = createImage({pixel_size: 32});
            applyTintedIcon(img, iconName, this._settings, style);
            btn.set_child(img);

            if (isCurrent)
                this._activeGridBtns.add(btn);

            btn.connect('clicked', () => {
                this._activeGridBtns.forEach(b => b.set_css_classes(['flat', 'circular']));
                this._activeGridBtns.clear();
                btn.set_css_classes(['suggested-action', 'circular']);
                this._activeGridBtns.add(btn);
                this._currentIcon = iconName;

                if (this._onSelectCallback)
                    this._onSelectCallback(iconName);
                else if (this._key)
                    this._settings.set_string(this._key, iconName);

                this.close();
            });

            const col = index % COLUMNS;
            const row = Math.floor(index / COLUMNS);
            grid.attach(btn, col, row, 1, 1);
        });

        return grid;
    }

    _createGrid(iconList) {
        const grid = this._createGridWidget(iconList);
        const wrapper = createBox({halign: 'fill'});
        wrapper.append(grid);
        return wrapper;
    }

    _openFileChooser(entryWidget) {
        const filter = createFileFilter(_('Image Files'), [], ['image/svg+xml', 'image/png']);
        openFileChooser(this.get_root(), {
            title: _('Select Image'),
            filters: [filter],
        }, path => entryWidget.set_text(path));
    }

    vfunc_dispose() {
        clearIds(this, removeTimer, '_inputTimeoutId');
        super.vfunc_dispose();
    }
}

function _setVisibleButton(btn, on) {
    btn.set_opacity(on ? 1 : 0);
    btn.set_sensitive(on);
}

// Enumerating and lookup-validating every symbolic icon is expensive, so it
// runs once per process, not per picker open.
let _systemIconsCache = null;
let _themeWatchConnected = false;

function _getSystemIcons() {
    if (_systemIconsCache)
        return _systemIconsCache;

    const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    if (!_themeWatchConnected) {
        _themeWatchConnected = true;
        iconTheme.connect('changed', () => (_systemIconsCache = null));
    }

    const filtered = iconTheme.get_icon_names().filter(name => {
        if (!name.endsWith('-symbolic'))
            return false;
        if (name.includes('night') || name.includes('rtl') || name.startsWith('adw-'))
            return false;

        // Icons from unrelated installed themes appear in get_icon_names()
        // without a real backing file in the shell's icon lookup path.
        const paintable = iconTheme.lookup_icon(
            name, null, 16, 1, Gtk.TextDirection.LTR, 0
        );
        return paintable.get_file() !== null;
    });

    _systemIconsCache = [...new Set(filtered)].sort();
    return _systemIconsCache;
}
