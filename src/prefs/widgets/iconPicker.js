import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {clearIds, removeTimer} from '../../shared/lifecycle.js';
import {themedIconWithFallback, pathOrThemedIcon} from '../../shared/icon.js';
import {createIconButton, createFileFilter} from './gtkHelpers.js';
import {openFileChooser} from '../dialogs/dialogs.js';
import {PAGE_JUMP_DEBOUNCE_MS} from '../../const.js';

// Pass `options.showCustom: false` to hide the free-form tab.
export default class IconPickerWidget extends Adw.PreferencesDialog {
    static {
        GObject.registerClass(this);
    }

    _init(settings, settingsKey, iconList, onSelectCallback = null, initialIcon = null, options = {}) {
        super._init({
            title: _('Select Icon'),
            content_width: 720,
            content_height: 720,
        });

        this._settings = settings;
        this._key = settingsKey;
        this._iconList = iconList || [];
        this._onSelectCallback = onSelectCallback;
        this._showCustom = options.showCustom !== false;

        this._currentIcon = initialIcon;
        if (!this._currentIcon && this._settings && this._key)
            this._currentIcon = this._settings.get_string(this._key);

        this._allSystemIcons = [];
        this._currentFilteredList = [];
        this._currentPage = 0;
        this._itemsPerPage = 32;
        this._inputTimeoutId = 0;

        // Both grids can highlight the current icon.
        // Tracks every active button so a click can clear the others.
        this._activeGridBtns = new Set();

        this._buildUI();
    }

    _buildUI() {
        if (this._iconList && this._iconList.length > 0) {
            const pageRec = new Adw.PreferencesPage({
                title: _('Recommended'),
                icon_name: 'emblem-favorite-symbolic',
                name: 'recommended',
            });
            const groupRec = new Adw.PreferencesGroup();
            pageRec.add(groupRec);
            groupRec.add(this._createGrid(this._iconList));
            this.add(pageRec);
        }

        this._allSystemIcons = _getSystemIcons();
        this._currentFilteredList = this._allSystemIcons;
        this._buildAllIconsPage();

        if (this._showCustom)
            this._buildCustomPage();

        this._setInitialTab();
    }

    _buildAllIconsPage() {
        const pageAll = new Adw.PreferencesPage({
            title: _('All Icons'),
            icon_name: 'view-grid-symbolic',
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

        this._allIconsGridContainer = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            halign: Gtk.Align.FILL,
        });
        this._resultsGroup.add(this._allIconsGridContainer);

        this._paginationGroup = new Adw.PreferencesGroup();
        pageAll.add(this._paginationGroup);

        const paginationBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.CENTER,
            spacing: 12,
            margin_top: 6, margin_bottom: 12,
        });
        this._paginationGroup.add(paginationBox);

        this._prevPageBtn = createIconButton('go-previous-symbolic', {tooltip_text: _('Previous')});

        this._pageEntry = new Gtk.Entry({
            width_chars: 4,
            max_length: 4,
            xalign: 0.5,
            valign: Gtk.Align.CENTER,
            input_purpose: Gtk.InputPurpose.DIGITS,
        });

        this._totalPageLabel = new Gtk.Label({
            label: '/ 1',
            css_classes: ['dim-label'],
        });

        this._nextPageBtn = createIconButton('go-next-symbolic', {tooltip_text: _('Next')});

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
            icon_name: 'document-properties-symbolic',
            name: 'custom',
        });
        const groupCustom = new Adw.PreferencesGroup({
            title: _('Custom Icon'),
            description: _('Type a name or pick an SVG/PNG file.'),
        });
        pageCustom.add(groupCustom);

        const previewImg = new Gtk.Image({
            pixel_size: 64,
            halign: Gtk.Align.CENTER,
            margin_top: 16,
        });

        const entry = new Gtk.Entry({
            placeholder_text: _('Icon name or path'),
            hexpand: true,
            valign: Gtk.Align.CENTER,
            text: this._currentIcon || '',
        });

        const updateCustomPreview = () => {
            const text = entry.text.trim();
            if (!text) {
                previewImg.clear();
                return;
            }
            previewImg.set_from_gicon(pathOrThemedIcon(text));
        };
        entry.connect('changed', updateCustomPreview);
        updateCustomPreview();

        const finishSelection = () => {
            const value = entry.text.trim();
            if (!value)
                return;
            if (this._onSelectCallback)
                this._onSelectCallback(value);
            else if (this._settings && this._key)
                this._settings.set_string(this._key, value);
            this.close();
        };

        entry.connect('activate', finishSelection);

        const customBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_top: 12, margin_bottom: 12,
            margin_start: 12, margin_end: 12,
        });

        const fileBtn = createIconButton('folder-open-symbolic', {
            flat: false,
            circular: false,
            tooltip_text: _('Choose file'),
        });
        fileBtn.connect('clicked', () => this._openFileChooser(entry));

        const applyBtn = createIconButton('object-select-symbolic', {
            flat: false,
            extraClasses: ['suggested-action'],
            tooltip_text: _('Apply'),
        });
        applyBtn.connect('clicked', finishSelection);

        customBox.append(entry);
        customBox.append(fileBtn);
        customBox.append(applyBtn);

        const wrapper = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        wrapper.append(previewImg);
        wrapper.append(customBox);
        groupCustom.add(wrapper);

        this.add(pageCustom);
    }

    _setInitialTab() {
        // Jump to the active icon's page every time the "All" tab opens.
        // _currentFilteredList is used instead of _allSystemIcons so the page
        // is correct while a search filter is active.
        this.connect('notify::visible-page-name', () => {
            if (this.visible_page_name !== 'all' || !this._currentIcon)
                return;
            const index = this._currentFilteredList.indexOf(this._currentIcon);
            if (index !== -1) {
                this._currentPage = Math.floor(index / this._itemsPerPage);
                this._renderAllIconsPage();
            }
        });

        // If the active icon is not in the recommended list, open the "All"
        // tab at the right page right away.
        if (this._currentIcon && !this._iconList?.includes(this._currentIcon)) {
            const index = this._allSystemIcons.indexOf(this._currentIcon);
            if (index !== -1)
                this._currentPage = Math.floor(index / this._itemsPerPage);
            this.set_visible_page_name('all');
        }
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
            clearIds(this, removeTimer, '_inputTimeoutId');
            this._inputTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PAGE_JUMP_DEBOUNCE_MS, () => {
                this._inputTimeoutId = 0;
                if (this.get_root())
                    this._jumpToPage(entry);
                return GLib.SOURCE_REMOVE;
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
        if (!this._allIconsGridContainer)
            return;

        let child = this._allIconsGridContainer.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._allIconsGridContainer.remove(child);
            child = next;
        }

        // Buttons from discarded page renders would otherwise pile up
        // and get restyled on every click.
        for (const btn of this._activeGridBtns) {
            if (!btn.get_root())
                this._activeGridBtns.delete(btn);
        }

        if (this._currentFilteredList.length === 0) {
            // Empty-state when the search filter excluded everything.
            const status = new Adw.StatusPage({
                icon_name: 'system-search-symbolic',
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
        if (!this._pageEntry)
            return;

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

        iconList.forEach((iconName, index) => {
            const btn = new Gtk.Button({
                height_request: 56,
                hexpand: true,
                tooltip_text: iconName,
            });

            const img = new Gtk.Image({pixel_size: 32});
            // ThemedIcon with fallback: GTK4 shows a blank image when setting icon_name
            // directly and the icon isn't in the current theme.
            // The fallback chain forces "image-missing" instead.
            img.set_from_gicon(themedIconWithFallback(iconName));
            btn.set_child(img);

            if (this._currentIcon === iconName) {
                btn.set_css_classes(['suggested-action', 'circular']);
                this._activeGridBtns.add(btn);
            } else {
                btn.set_css_classes(['flat', 'circular']);
            }

            btn.connect('clicked', () => {
                // Clear every previously highlighted button across all grids
                // before marking the clicked one.
                // Keeps Recommended and All Icons in sync.
                this._activeGridBtns.forEach(b => b.set_css_classes(['flat', 'circular']));
                this._activeGridBtns.clear();
                btn.set_css_classes(['suggested-action', 'circular']);
                this._activeGridBtns.add(btn);
                this._currentIcon = iconName;

                if (this._onSelectCallback)
                    this._onSelectCallback(iconName);
                else if (this._settings && this._key)
                    this._settings.set_string(this._key, iconName);

                this.close();
            });

            const col = index % COLUMNS;
            const row = Math.floor(index / COLUMNS);
            grid.attach(btn, col, row, 1, 1);
        });

        return grid;
    }

    // Adw.PreferencesGroup only fills its width when the direct child is a
    // Gtk.Box, so the grid needs a wrapper.
    _createGrid(iconList) {
        const grid = this._createGridWidget(iconList);
        const wrapper = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            halign: Gtk.Align.FILL,
        });
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

// Enumerating and lookup-validating every symbolic icon is a sweep over
// thousands of names, so it runs once per process, not per picker open.
let _systemIconsCache = null;
let _themeWatchConnected = false;

function _getSystemIcons() {
    if (_systemIconsCache)
        return _systemIconsCache;

    const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    if (!_themeWatchConnected) {
        _themeWatchConnected = true;
        // Invalidate lazily, the next open re-enumerates.
        iconTheme.connect('changed', () => (_systemIconsCache = null));
    }

    const filtered = iconTheme.get_icon_names().filter(name => {
        if (!name.endsWith('-symbolic'))
            return false;
        if (name.includes('night') || name.includes('rtl') || name.startsWith('adw-'))
            return false;

        // Verify the icon resolves to an actual file. Icons from unrelated
        // installed themes can appear in get_icon_names() without having
        // a real backing file in the shell's icon lookup path.
        const paintable = iconTheme.lookup_icon(
            name, null, 16, 1, Gtk.TextDirection.LTR, 0
        );
        return paintable !== null && paintable.get_file() !== null;
    });

    _systemIconsCache = [...new Set(filtered)].sort();
    return _systemIconsCache;
}
