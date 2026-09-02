import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {clearIds, connectScoped, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {clearChildren, createBox, createLabel} from './text.js';
import {createButton, createIconButton} from './button.js';
import {createFileFilter, openFileChooser} from './dialog.js';
import {createImage} from './image.js';
import {applyPathIcon, applyTintedIcon, prefsForegroundColor, NEXT_ICON_NAME} from './icon.js';

// Long enough to type a second digit.
const PAGE_JUMP_DEBOUNCE_MS = 500;
const ITEMS_PER_PAGE = 32;

const DIALOG_CONTENT_WIDTH_PX = 720;
const DIALOG_CONTENT_HEIGHT_PX = 720;
const GRID_BUTTON_HEIGHT_PX = 56;
const GRID_ICON_SIZE_PX = 32;
const PREVIEW_ICON_SIZE_PX = 64;

const GRID_COLUMNS = 8;

const ALL_ICONS_PAGE_NAME = 'all';

// The configured panel color can be anything and would vanish in here.
const pickerIconStyle = () => ({tint: prefsForegroundColor()});

export default class IconPickerDialog extends Adw.PreferencesDialog {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsIconPickerWidget'}, this);
    }

    _init(settings, settingsKey, iconList, onSelectCallback, initialIcon, options = {}) {
        super._init({
            title: _('Select Icon'),
            content_width: DIALOG_CONTENT_WIDTH_PX,
            content_height: DIALOG_CONTENT_HEIGHT_PX,
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
        this._inputTimeoutId = 0;

        // Both grids can show the current icon, so a click clears the other's highlight.
        this._activeGridButtons = new Set();

        this._buildUI();
    }

    _buildUI() {
        if (this._iconList.length > 0) {
            const recommendedPage = new Adw.PreferencesPage({
                title: _('Recommended'),
                icon_name: 'bti-star-symbolic',
                name: 'recommended',
            });
            this._recommendedGroup = new Adw.PreferencesGroup();
            recommendedPage.add(this._recommendedGroup);
            this._fillRecommendedGrid();
            this.add(recommendedPage);
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
        this._recommendedGrid = createBox({halign: 'fill'});
        this._recommendedGrid.append(this._createGridWidget(this._iconList));
        this._recommendedGroup.add(this._recommendedGrid);
    }

    _buildAllIconsPage() {
        const allIconsPage = new Adw.PreferencesPage({
            title: _('All Icons'),
            icon_name: 'bti-grid-symbolic',
            name: ALL_ICONS_PAGE_NAME,
        });

        const searchGroup = new Adw.PreferencesGroup();
        allIconsPage.add(searchGroup);

        const searchEntry = new Gtk.SearchEntry({
            placeholder_text: _('Search icons…'),
            hexpand: true,
            margin_top: 12, margin_bottom: 0,
            margin_start: 12, margin_end: 12,
        });
        searchGroup.add(searchEntry);

        this._resultsGroup = new Adw.PreferencesGroup({title: _('System Icons')});
        allIconsPage.add(this._resultsGroup);

        this._allIconsGridContainer = createBox({halign: 'fill'});
        this._resultsGroup.add(this._allIconsGridContainer);

        this._paginationGroup = new Adw.PreferencesGroup();
        allIconsPage.add(this._paginationGroup);

        const paginationBox = createBox({
            orientation: 'horizontal', halign: 'center', spacing: 12,
            margin_top: 6, margin_bottom: 12,
        });
        this._paginationGroup.add(paginationBox);

        this._previousPageButton = createIconButton('bti-previous-symbolic', {tooltip: _('Previous')});

        this._pageEntry = new Gtk.Entry({
            width_chars: 4,
            max_length: 4,
            xalign: 0.5,
            valign: Gtk.Align.CENTER,
            input_purpose: Gtk.InputPurpose.DIGITS,
        });

        this._totalPageLabel = createLabel('/ 1', ['dim-label']);

        this._nextPageButton = createIconButton(NEXT_ICON_NAME, {tooltip: _('Next')});

        paginationBox.append(this._previousPageButton);
        paginationBox.append(this._pageEntry);
        paginationBox.append(this._totalPageLabel);
        paginationBox.append(this._nextPageButton);

        this._setupPaginationEvents(searchEntry);
        this._renderAllIconsPage();
        this.add(allIconsPage);
    }

    _buildCustomPage() {
        const customPage = new Adw.PreferencesPage({
            title: _('Custom'),
            icon_name: 'bti-properties-symbolic',
            name: 'custom',
        });
        const customGroup = new Adw.PreferencesGroup({
            title: _('Custom Icon'),
            description: _('Type a name or pick an SVG/PNG file.'),
        });
        customPage.add(customGroup);

        const previewImage = createImage({pixel_size: PREVIEW_ICON_SIZE_PX, halign: 'center', margin_top: 16});

        const entry = new Gtk.Entry({
            placeholder_text: _('Icon name or path'),
            hexpand: true,
            valign: Gtk.Align.CENTER,
            text: this._currentIcon || '',
        });

        this._updateCustomPreview = () =>
            applyPathIcon(previewImage, entry.text.trim(), this._settings, pickerIconStyle());
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

        const fileButton = createIconButton('bti-folder-symbolic', {
            flat: false,
            circular: false,
            tooltip: _('Choose file'),
        });
        fileButton.connect('clicked', () => this._openFileChooser(entry));

        const applyButton = createIconButton('bti-select-symbolic', {
            flat: false,
            extraClasses: ['suggested-action'],
            tooltip: _('Apply'),
        });
        applyButton.connect('clicked', finishSelection);

        customBox.append(entry);
        customBox.append(fileButton);
        customBox.append(applyButton);

        const wrapper = createBox();
        wrapper.append(previewImage);
        wrapper.append(customBox);
        customGroup.add(wrapper);

        this.add(customPage);
    }

    _setInitialTab() {
        this.connect('notify::visible-page-name', () => this._showPageWithCurrentIcon());

        if (this._currentIcon && !this._iconList.includes(this._currentIcon))
            this.set_visible_page_name(ALL_ICONS_PAGE_NAME);

        // With no recommended list the dialog already sits on 'all', so no notify fires.
        this._showPageWithCurrentIcon();
    }

    _showPageWithCurrentIcon() {
        if (this.visible_page_name !== ALL_ICONS_PAGE_NAME || !this._currentIcon)
            return;
        const index = this._currentFilteredList.indexOf(this._currentIcon);
        if (index === -1)
            return;
        const page = Math.floor(index / ITEMS_PER_PAGE);
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
        this._previousPageButton.connect('clicked', () => {
            if (this._currentPage === 0)
                return;
            this._currentPage--;
            this._renderAllIconsPage();
        });

        this._nextPageButton.connect('clicked', () => {
            const totalPages = Math.ceil(this._currentFilteredList.length / ITEMS_PER_PAGE);
            if (this._currentPage >= totalPages - 1)
                return;
            this._currentPage++;
            this._renderAllIconsPage();
        });

        searchEntry.connect('search-changed', entry => {
            const query = entry.text.toLowerCase();
            this._currentFilteredList = query
                ? this._allSystemIcons.filter(name => name.toLowerCase().includes(query))
                : this._allSystemIcons;
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
        const requestedPage = parseInt(inputEntry.text);
        const totalPages = Math.ceil(this._currentFilteredList.length / ITEMS_PER_PAGE) || 1;
        const isInRange = requestedPage >= 1 && requestedPage <= totalPages;
        if (isNaN(requestedPage) || !isInRange)
            return;

        // _updatePaginationUI writes the entry text itself, which fires 'changed' again.
        if (requestedPage - 1 === this._currentPage)
            return;

        this._currentPage = requestedPage - 1;
        this._renderAllIconsPage();
    }

    _renderAllIconsPage() {
        clearChildren(this._allIconsGridContainer);

        // Buttons from old page renders would pile up and get restyled on every click.
        for (const button of this._activeGridButtons) {
            if (!button.get_root())
                this._activeGridButtons.delete(button);
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

        const start = this._currentPage * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageItems = this._currentFilteredList.slice(start, end);

        const grid = this._createGridWidget(pageItems);
        this._allIconsGridContainer.append(grid);

        this._updatePaginationUI();
    }

    _updatePaginationUI() {
        const totalItems = this._currentFilteredList.length;
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;

        _setButtonAvailable(this._previousPageButton, this._currentPage > 0);
        _setButtonAvailable(this._nextPageButton, this._currentPage < totalPages - 1);

        const pageText = (this._currentPage + 1).toString();
        if (this._pageEntry.text !== pageText && !this._pageEntry.has_focus)
            this._pageEntry.set_text(pageText);

        this._totalPageLabel.set_label(`/ ${totalPages}`);
    }

    _createGridWidget(iconList) {
        const grid = new Gtk.Grid({
            column_spacing: 8, row_spacing: 8,
            halign: Gtk.Align.FILL, hexpand: true,
            margin_top: 8, margin_bottom: 8,
            margin_start: 8, margin_end: 8,
        });

        const style = pickerIconStyle();

        iconList.forEach((iconName, index) => {
            const isCurrent = this._currentIcon === iconName;
            const button = createButton({
                valign: 'fill',
                height_request: GRID_BUTTON_HEIGHT_PX,
                hexpand: true,
                tooltip_text: iconName,
                cssClasses: isCurrent ? ['suggested-action', 'circular'] : ['flat', 'circular'],
            });

            const image = createImage({pixel_size: GRID_ICON_SIZE_PX});
            applyTintedIcon(image, iconName, this._settings, style);
            button.set_child(image);

            if (isCurrent)
                this._activeGridButtons.add(button);

            button.connect('clicked', () => {
                this._activeGridButtons.forEach(b => b.set_css_classes(['flat', 'circular']));
                this._activeGridButtons.clear();
                button.set_css_classes(['suggested-action', 'circular']);
                this._activeGridButtons.add(button);
                this._currentIcon = iconName;

                if (this._onSelectCallback)
                    this._onSelectCallback(iconName);
                else if (this._key)
                    this._settings.set_string(this._key, iconName);

                this.close();
            });

            const col = index % GRID_COLUMNS;
            const row = Math.floor(index / GRID_COLUMNS);
            grid.attach(button, col, row, 1, 1);
        });

        return grid;
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

function _setButtonAvailable(button, isAvailable) {
    button.set_opacity(isAvailable ? 1 : 0);
    button.set_sensitive(isAvailable);
}

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
        return !name.includes('night') && !name.includes('rtl') && !name.startsWith('adw-');
    });

    _systemIconsCache = [...new Set(filtered)].sort();
    return _systemIconsCache;
}
