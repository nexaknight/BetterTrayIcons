import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {disconnectAll} from '../../shared/lifecycle.js';
import {fetchJson, fetchBytes, isCancelledError} from '../../shared/asyncIo.js';
import {createLabel, createBox, createPicture, createImage, createAvatar, createCard, createCardRow, createTextureFromBytes, createButton} from '../widgets/gtkHelpers.js';
import {createActionRow} from '../widgets/rows.js';
import {bindLogoToTheme} from '../widgets/theme.js';
import {openUri, showTextDialog, buildGroupDialog} from '../dialogs/dialogs.js';
import {CONTRIBUTORS_OPTOUT} from '../../const.js';

const GIT_REPO_URL = 'https://github.com/nexaknight/BetterTrayIcons';

const GITHUB_API_REPO_URL = GIT_REPO_URL.replace('github.com/', 'api.github.com/repos/');

const LICENSE_URL = 'https://github.com/nexaknight/BetterTrayIcons/blob/main/LICENSE';

const SPONSOR_URL = 'https://github.com/sponsors/nexaknight';

const TRANSLATE_URL = 'https://github.com/nexaknight/BetterTrayIcons/wiki/Translation-Guidelines';

// Our glyphs fill their whole canvas while symbolic theme icons carry
// padding, so they need a smaller box to read at the same weight.
const ABOUT_ROW_ICON_SIZE_PX = 16;

const ABOUT_INLINE_ICON_SIZE_PX = 18;

const MAX_CONTRIBUTORS = 5;

// Releases accumulate over the project's lifetime, so the dialog starts
// with one page and fetches the next on demand instead of pulling the
// whole history up front.
const CHANGELOG_PAGE_SIZE = 5;

const CHANGELOG_DIALOG_WIDTH_PX = 600;

export class AboutPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass({GTypeName: 'BetterTrayIconsAboutPage'}, this);
    }

    _init(extensionDir, metadata, settings) {
        super._init({
            title: _('About'),
            icon_name: 'bti-about-symbolic',
        });

        this._extensionDir = extensionDir;
        this._metadata = metadata;
        this._settings = settings;
        this._themeSignals = [];
        // Cancelled in vfunc_unroot so fetches can't touch destroyed widgets.
        this._cancellable = new Gio.Cancellable();

        this._buildUI();
    }

    _buildUI() {
        this._assetsDir = this._extensionDir.get_child('assets');
        const translateBanner = new Adw.Banner({
            title: _('Help translate this extension.'),
            button_label: _('Translate'),
            revealed: true,
        });
        translateBanner.connect('button-clicked', () => {
            openUri(this.get_root(), TRANSLATE_URL);
        });
        this.set_banner(translateBanner);

        const infoGroup = new Adw.PreferencesGroup({title: _('Information')});
        this.add(infoGroup);

        // extensions.gnome.org stamps the numeric version on upload, so a build
        // without one was installed from git and gets marked as such.
        const {version, 'version-name': versionName} = this._metadata;
        const versionLabel = createLabel(
            [versionName, version ? null : 'dev'].filter(Boolean).join(' ') || 'dev');
        const versionRow = createActionRow(_('Version'), '', {
            prefixWidget: this._createIcon('bti-tag-symbolic', ABOUT_ROW_ICON_SIZE_PX),
            headerSuffix: versionLabel,
        });
        infoGroup.add(versionRow);

        const githubBox = createBox({orientation: 'horizontal', spacing: 6, valign: 'center', halign: 'end'});

        const githubIcon = this._createIcon('bti-github-symbolic', ABOUT_INLINE_ICON_SIZE_PX, {
            tooltip_text: _('Open on GitHub'),
        });

        githubBox.append(githubIcon);
        githubBox.append(createLabel('GitHub', []));

        const sourceRow = createActionRow(_('Source Code'), '', {
            prefixWidget: this._createIcon('bti-code-symbolic', ABOUT_ROW_ICON_SIZE_PX),
            headerSuffix: githubBox,
            onActivate: () => openUri(this.get_root(), GIT_REPO_URL),
        });
        infoGroup.add(sourceRow);

        const changelogRow = createActionRow(
            _('Changelog'),
            _('Recent releases'),
            {
                prefixWidget: this._createIcon('bti-changelog-symbolic', ABOUT_ROW_ICON_SIZE_PX),
                onActivate: () => this._fetchAndShowChangelog(),
            }
        );
        infoGroup.add(changelogRow);

        const donationRow = createActionRow(
            _('Sponsor'),
            _('Support development.'),
            {
                prefixWidget: this._createIcon('bti-heart-symbolic', ABOUT_ROW_ICON_SIZE_PX),
                suffixWidgets: [this._createIcon('adw-external-link-symbolic', ABOUT_INLINE_ICON_SIZE_PX)],
                onActivate: () => openUri(this.get_root(), SPONSOR_URL),
            }
        );
        infoGroup.add(donationRow);

        const contribGroup = new Adw.PreferencesGroup({title: _('Contributors')});
        this.add(contribGroup);

        this._setupContributorsLoader(contribGroup);

        const legalGroup = new Adw.PreferencesGroup({
            title: _('Legal'),
        });

        legalGroup.add(createActionRow(_('License'), '', {
            prefixWidget: this._createIcon('bti-license-symbolic', ABOUT_ROW_ICON_SIZE_PX),
            onActivate: () => openUri(this.get_root(), LICENSE_URL),
        }));

        const disclaimerLabel = createLabel(
            _('Provided "as is", without warranty. The authors are not liable for damages.'),
            ['dim-label', 'caption'],
            {wrap: true, xalign: 0, margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12}
        );
        legalGroup.add(disclaimerLabel);
        this.add(legalGroup);

        const creditsGroup = new Adw.PreferencesGroup();
        this.add(creditsGroup);

        const footerBox = createBox({
            orientation: 'vertical',
            spacing: 12,
            halign: 'center',
            margin_top: 24,
            margin_bottom: 24,
        });

        const createdByLabel = createLabel(_('Powered by'), ['title-4']);
        footerBox.append(createdByLabel);

        const logo = createPicture({
            can_shrink: true,
            content_fit: Gtk.ContentFit.CONTAIN,
            width_request: 160,
            height_request: 160,
            halign: 'center',
            visible: false,
        });

        const fallbackLabel = createLabel('BetterTrayIcons', ['display-3', 'dim-label'], {visible: false});

        footerBox.append(logo);
        footerBox.append(fallbackLabel);

        creditsGroup.add(footerBox);

        // Reading and rasterizing the logo is the expensive part of this
        // page, so defer it until the page is actually shown.
        const mapId = this.connect('map', () => {
            this.disconnect(mapId);
            this._themeSignals.push(bindLogoToTheme(logo, fallbackLabel, this._assetsDir, 'logo.svg'));
        });
    }

    _createIcon(iconName, size, props = {}) {
        return createImage({
            icon_name: iconName,
            pixel_size: size,
            valign: 'center',
            halign: 'center',
            ...props,
        });
    }

    async _fetchAndShowChangelog() {
        try {
            const releases = await this._fetchReleasePage(1);
            if (releases.length === 0) {
                showTextDialog(this.get_root(), _('Changelog'), _('No releases found.'));
                return;
            }
            this._showChangelogDialog(releases);
        } catch (e) {
            if (isCancelledError(e))
                return;
            error('Failed to fetch changelog', e);
            showTextDialog(this.get_root(), _('Changelog'), _('Failed to load changelog: ') + e.message);
        }
    }

    async _fetchReleasePage(page) {
        const url = `${GITHUB_API_REPO_URL}/releases?per_page=${CHANGELOG_PAGE_SIZE}&page=${page}`;
        const releases = await fetchJson(url, this._cancellable);
        return Array.isArray(releases) ? releases : [];
    }

    _showChangelogDialog(firstPage) {
        const {group, present} = buildGroupDialog({
            title: _('Changelog'),
            width: CHANGELOG_DIALOG_WIDTH_PX,
        });

        const list = createBox({orientation: 'vertical'});
        group.add(list);
        firstPage.forEach((release, i) => _appendRelease(list, release, i > 0));

        let page = 1;
        // A page shorter than the batch is the last one, a full page may
        // have more behind it.
        const moreBtn = createButton({
            label: _('Load older releases'),
            halign: 'center',
            margin_bottom: 12,
            visible: firstPage.length === CHANGELOG_PAGE_SIZE,
        });
        moreBtn.connect('clicked', async () => {
            moreBtn.sensitive = false;
            try {
                const releases = await this._fetchReleasePage(page + 1);
                page += 1;
                releases.forEach(release => _appendRelease(list, release, true));
                moreBtn.visible = releases.length === CHANGELOG_PAGE_SIZE;
            } catch (e) {
                if (isCancelledError(e))
                    return;
                error('Failed to fetch changelog', e);
            } finally {
                moreBtn.sensitive = true;
            }
        });
        group.add(moreBtn);

        present(this.get_root());
    }

    // Network access is opt-in, so nothing loads until the user clicks.
    _setupContributorsLoader(group) {
        const loadBtn = createButton({
            label: _('Load'),
            cssClasses: ['suggested-action'],
            valign: 'center',
        });

        const placeholder = createActionRow(
            _('Loaded from GitHub'),
            _('Contacts api.github.com on demand.'),
            {prefixWidget: this._createIcon('bti-users-symbolic', ABOUT_ROW_ICON_SIZE_PX), headerSuffix: loadBtn}
        );
        group.add(placeholder);

        loadBtn.connect('clicked', () => {
            group.remove(placeholder);
            this._loadContributors(group);
        });
    }

    async _loadContributors(group) {
        const spinner = new Adw.Spinner({visible: true});
        const loadingRow = createActionRow(_('Loading…'), '', {headerSuffix: spinner});
        group.add(loadingRow);

        try {
            let data = [];
            try {
                data = await fetchJson(`${GITHUB_API_REPO_URL}/contributors`, this._cancellable);
            } catch (e) {
                if (isCancelledError(e))
                    return;
                error(`Failed to fetch contributors: ${e.message}`);
            }

            const uncached = await fetchMissingContributors(data, this._cancellable);

            // Apply the opt-out filter before slicing, so an opted-out user
            // never displaces a visible contributor.
            data = filterContributors(data.concat(uncached));
            data.sort((a, b) => b.contributions - a.contributions);

            group.remove(loadingRow);

            if (data.length === 0) {
                const noContribLabel = createLabel(_('No contributors found'), ['dim-label'], {halign: 'center', margin_top: 12, margin_bottom: 12});
                group.add(noContribLabel);
                return;
            }

            const top = data.slice(0, MAX_CONTRIBUTORS);
            const cards = top.map(c => {
                const avatar = createAvatar({
                    size: 56,
                    text: c.login,
                    halign: 'center',
                });
                if (c.avatar_url)
                    this._loadAvatarImage(avatar, c.avatar_url);

                return createCard({
                    avatar,
                    title: c.login,
                    subtitle: `${c.contributions} ${_('commits')}`,
                    tooltip: c.login,
                    onActivate: () => openUri(this.get_root(), c.html_url),
                });
            });

            if (data.length > MAX_CONTRIBUTORS) {
                const moreUrl = `${GIT_REPO_URL}/graphs/contributors`;
                cards.push(createCard({
                    iconName: 'bti-other-symbolic',
                    iconSize: 48,
                    title: _('Show more'),
                    tooltip: _('Open on GitHub'),
                    onActivate: () => openUri(this.get_root(), moreUrl),
                }));
            }

            group.add(createCardRow(cards));
        } catch (e) {
            error('Contributor loader crash', e);
            group.remove(loadingRow);
            const errorLabel = createLabel(_('Error loading data'), ['error'], {halign: 'center', margin_top: 12, margin_bottom: 12});
            group.add(errorLabel);
        }
    }

    async _loadAvatarImage(avatar, url) {
        try {
            const bytes = await fetchBytes(url, this._cancellable);
            const texture = createTextureFromBytes(bytes);
            if (texture)
                avatar.set_custom_image(texture);
        } catch (e) {
            if (isCancelledError(e))
                return;
            error(`Failed to load avatar for ${url}`, e);
        }
    }

    vfunc_unroot() {
        this._cancellable?.cancel();
        this._cancellable = null;
        disconnectAll(this, Adw.StyleManager.get_default(), '_themeSignals');
        super.vfunc_unroot();
    }
}

function filterContributors(list) {
    if (!Array.isArray(list))
        return [];
    return list.filter(c =>
        c && typeof c.login === 'string' && !CONTRIBUTORS_OPTOUT.has(c.login.toLowerCase())
    );
}

// GitHub serves the contributors list from a cache it documents as possibly
// a few hours old, so whoever landed their first commit today is missing.
// The statistics endpoint has them right away, but it answers 202 with an
// empty body while it recomputes, so it augments the list instead of
// replacing it.
async function fetchMissingContributors(known, cancellable) {
    let stats;
    try {
        stats = await fetchJson(`${GITHUB_API_REPO_URL}/stats/contributors`, cancellable);
    } catch {
        return [];
    }

    if (!Array.isArray(stats))
        return [];

    const seen = new Set(known.map(c => c?.login?.toLowerCase()));
    return stats
        .filter(s => s?.author?.login && !seen.has(s.author.login.toLowerCase()))
        .map(s => ({
            login: s.author.login,
            avatar_url: s.author.avatar_url,
            html_url: s.author.html_url,
            contributions: s.total,
        }));
}

function _appendRelease(list, release, withSeparator) {
    if (withSeparator)
        list.append(new Gtk.Separator({margin_start: 12, margin_end: 12}));

    const name = GLib.markup_escape_text(String(release.name || release.tag_name || ''), -1);
    list.append(createLabel(
        `<span size="x-large" weight="bold">${name}</span>\n${markdownToPango(release.body)}`,
        [],
        {
            use_markup: true,
            wrap: true,
            xalign: 0,
            focusable: false,
            margin_top: 12, margin_bottom: 12,
            margin_start: 12, margin_end: 12,
        }
    ));
}

// Release bodies are markdown, only the subset release-please emits gets
// converted. Each line is escaped first so a body can't break out into
// markup the GtkLabel would refuse to render.
function markdownToPango(md) {
    // Headings need the inline pass too, release-please puts the compare
    // link right inside the version heading.
    const inline = text => text
        .replace(/^(\s*)[*+-]\s+/, '$1• ')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^()\s]+)\)/g, '<a href="$2">$1</a>');
    return String(md ?? '').replace(/\r/g, '').split('\n').map(line => {
        line = GLib.markup_escape_text(line, -1);
        const heading = line.match(/^#{1,6}\s+(.*)/);
        if (heading)
            return `<span weight="bold" size="large">${inline(heading[1])}</span>`;
        return inline(line);
    }).join('\n').trim();
}
