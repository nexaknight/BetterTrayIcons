import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {fetchJson, fetchBytes, isCancelledError, readFileText} from '../../shared/asyncIo.js';
import {createAvatar, createImage, createPicture, createTextureFromBytes, bindLogoToTheme} from '../components/image.js';
import {createBox, createLabel} from '../components/text.js';
import {createButton} from '../components/button.js';
import {createCard, createCardRow} from '../components/card.js';
import {createMarkdownView} from '../components/markdown.js';
import {createActionRow, createExpanderSection} from '../components/row.js';
import {showTextDialog, buildGroupDialog} from '../components/dialog.js';
import {CONTRIBUTORS_OPTOUT, DONATION_SERVICES} from '../../const.js';
import {DBUS_SPECS, inspirationLinks} from '../../shared/credits.js';

const GIT_REPO_URL = 'https://github.com/nexaknight/BetterTrayIcons';

const GITHUB_API_REPO_URL = GIT_REPO_URL.replace('github.com/', 'api.github.com/repos/');

const LICENSE_URL = 'https://github.com/nexaknight/BetterTrayIcons/blob/main/LICENSE';

const TRANSLATE_URL = 'https://github.com/nexaknight/BetterTrayIcons/wiki/Translation-Guidelines';

// Our glyphs fill their whole canvas while symbolic theme icons carry
// padding, so they need a smaller box to read at the same weight.
const ABOUT_ROW_ICON_SIZE_PX = 16;

const ABOUT_INLINE_ICON_SIZE_PX = 18;

const LINK_ICON_NAME = 'bti-link-symbolic';

const MAX_CONTRIBUTORS = 5;

const CONTRIBUTOR_AVATAR_SIZE_PX = 56;

const SHOW_MORE_ICON_SIZE_PX = 48;

const ABOUT_LOGO_SIZE_PX = 160;

const LINK_DIALOG_WIDTH_PX = 500;

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
            _openUri(this.get_root(), TRANSLATE_URL);
        });
        this.set_banner(translateBanner);

        const infoGroup = new Adw.PreferencesGroup({title: _('Information')});
        this.add(infoGroup);

        // extensions.gnome.org stamps the numeric version on upload, so a build
        // without one was installed from git and gets marked as such.
        const {version, 'version-name': versionName} = this._metadata;
        const versionLabel = createLabel(
            [versionName, version ? null : 'dev'].filter(Boolean).join(' '));
        const versionRow = createActionRow({
            title: _('Version'),
            prefixWidget: this._createIcon('bti-tag-symbolic', ABOUT_ROW_ICON_SIZE_PX),
            headerSuffix: versionLabel,
        });
        infoGroup.add(versionRow);

        const githubBox = createBox({orientation: 'horizontal', spacing: 6, valign: 'center', halign: 'end'});

        const githubIcon = this._createIcon('bti-github-symbolic', ABOUT_INLINE_ICON_SIZE_PX, {
            tooltip_text: _('Open on GitHub'),
        });

        githubBox.append(githubIcon);
        githubBox.append(createLabel('GitHub'));

        const sourceRow = createActionRow({
            title: _('Source Code'),
            prefixWidget: this._createIcon('bti-code-symbolic', ABOUT_ROW_ICON_SIZE_PX),
            headerSuffix: githubBox,
            onActivate: () => _openUri(this.get_root(), GIT_REPO_URL),
        });
        infoGroup.add(sourceRow);

        const changelogRow = createActionRow({
            title: _('Changelog'),
            subtitle: _('Recent releases'),
            prefixWidget: this._createIcon('bti-changelog-symbolic', ABOUT_ROW_ICON_SIZE_PX),
            onActivate: () => this._fetchAndShowChangelog(),
        });
        infoGroup.add(changelogRow);

        infoGroup.add(this._createDonationsRow());

        const contributorsGroup = new Adw.PreferencesGroup({title: _('Contributors')});
        this.add(contributorsGroup);

        this._setupContributorsLoader(contributorsGroup);

        const legalGroup = new Adw.PreferencesGroup({
            title: _('Legal'),
        });

        legalGroup.add(this._createCreditsRow());
        legalGroup.add(createActionRow({
            title: _('License'),
            prefixWidget: this._createIcon('bti-license-symbolic', ABOUT_ROW_ICON_SIZE_PX),
            onActivate: () => _openUri(this.get_root(), LICENSE_URL),
        }));

        const disclaimerLabel = createLabel(
            _('Provided "as is", without warranty. The authors are not liable for damages.'),
            ['dimmed', 'caption'],
            {wrap: true, xalign: 0, margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12}
        );
        legalGroup.add(disclaimerLabel);
        legalGroup.add(this._buildFooter());
        this.add(legalGroup);
    }

    _createDonationsRow() {
        const {expander, setRows} = createExpanderSection({
            title: _('Sponsor'),
            subtitle: _('Support development.'),
        });
        expander.add_prefix(this._createIcon('bti-heart-symbolic', ABOUT_ROW_ICON_SIZE_PX));
        setRows(_donationLinks(this._metadata.donations).map(({name, url, iconName}) => createActionRow({
            title: name,
            subtitle: url,
            prefixWidget: this._createIcon(iconName, ABOUT_ROW_ICON_SIZE_PX),
            suffixWidgets: [this._createIcon(LINK_ICON_NAME, ABOUT_INLINE_ICON_SIZE_PX)],
            onActivate: () => _openUri(this.get_root(), url),
        })));
        return expander;
    }

    _createCreditsRow() {
        const {expander, setRows} = createExpanderSection({title: _('Credits')});
        expander.add_prefix(this._createIcon('bti-star-symbolic', ABOUT_ROW_ICON_SIZE_PX));
        setRows([
            createActionRow({
                title: _('Icons and Emojis'),
                prefixWidget: this._createIcon('bti-grid-symbolic', ABOUT_ROW_ICON_SIZE_PX),
                onActivate: () => this._showIconAndEmojiCredits(),
            }),
            createActionRow({
                title: _('D-Bus Interfaces'),
                prefixWidget: this._createIcon('bti-code-symbolic', ABOUT_ROW_ICON_SIZE_PX),
                onActivate: () => this._showLinkDialog(_('D-Bus Interfaces'),
                    _('The specifications behind the interface files BTI implements.'), DBUS_SPECS),
            }),
            createActionRow({
                title: _('Inspiration'),
                prefixWidget: this._createIcon('bti-users-symbolic', ABOUT_ROW_ICON_SIZE_PX),
                onActivate: () => this._showLinkDialog(_('Inspiration'),
                    _('Projects BTI learned from.'), inspirationLinks(_)),
            }),
        ]);
        return expander;
    }

    async _showIconAndEmojiCredits() {
        const files = ['icons', 'emoji'].map(dir => this._assetsDir.get_child(dir).get_child('CREDITS.md'));
        let texts;
        try {
            texts = await Promise.all(files.map(file => readFileText(file, this._cancellable)));
        } catch (e) {
            if (isCancelledError(e))
                return;
            error('Failed to read the icon and emoji credits', e);
            return;
        }
        const {groups, present} = buildGroupDialog({
            title: _('Icons and Emojis'),
            width: CHANGELOG_DIALOG_WIDTH_PX,
            tabs: [_('Icons'), _('Emojis')],
        });
        texts.forEach((text, i) => groups[i].add(createMarkdownView(text)));
        present(this.get_root());
    }

    _showLinkDialog(title, description, links) {
        const {group, present} = buildGroupDialog({title, width: LINK_DIALOG_WIDTH_PX});
        group.description = description;
        for (const {name, url, about} of links) {
            group.add(createActionRow({
                title: name,
                subtitle: about ?? url,
                prefixWidget: this._createIcon(url.includes('github.com') ? 'bti-github-symbolic' : LINK_ICON_NAME, ABOUT_ROW_ICON_SIZE_PX),
                suffixWidgets: [this._createIcon(LINK_ICON_NAME, ABOUT_INLINE_ICON_SIZE_PX)],
                onActivate: () => _openUri(this.get_root(), url),
            }));
        }
        present(this.get_root());
    }

    _buildFooter() {
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
            width_request: ABOUT_LOGO_SIZE_PX,
            height_request: ABOUT_LOGO_SIZE_PX,
            halign: 'center',
            visible: false,
        });

        const fallbackLabel = createLabel('BetterTrayIcons', ['display-3', 'dimmed'], {visible: false});

        footerBox.append(logo);
        footerBox.append(fallbackLabel);

        // Reading and rasterizing the logo is the expensive part of this
        // page, so defer it until the page is shown.
        const mapId = this.connect('map', () => {
            this.disconnect(mapId);
            bindLogoToTheme(logo, fallbackLabel, this._assetsDir, 'logo.svg');
        });
        return footerBox;
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
                showTextDialog(this.get_root(), {title: _('Changelog'), content: _('No releases found.')});
                return;
            }
            this._showChangelogDialog(releases);
        } catch (e) {
            if (isCancelledError(e))
                return;
            error('Failed to fetch changelog', e);
            showTextDialog(this.get_root(), {
                title: _('Changelog'),
                content: _('Failed to load changelog: ') + e.message,
            });
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
        const moreButton = createButton({
            label: _('Load older releases'),
            halign: 'center',
            margin_bottom: 12,
            visible: firstPage.length === CHANGELOG_PAGE_SIZE,
        });
        moreButton.connect('clicked', async () => {
            moreButton.sensitive = false;
            try {
                const releases = await this._fetchReleasePage(page + 1);
                page += 1;
                releases.forEach(release => _appendRelease(list, release, true));
                moreButton.visible = releases.length === CHANGELOG_PAGE_SIZE;
            } catch (e) {
                if (isCancelledError(e))
                    return;
                error('Failed to fetch changelog', e);
            } finally {
                moreButton.sensitive = true;
            }
        });
        group.add(moreButton);

        present(this.get_root());
    }

    _setupContributorsLoader(group) {
        const loadButton = createButton({
            label: _('Load'),
            cssClasses: ['suggested-action'],
            valign: 'center',
        });

        const placeholder = createActionRow({
            title: _('Loaded from GitHub'),
            subtitle: _('Contacts api.github.com on demand.'),
            prefixWidget: this._createIcon('bti-users-symbolic', ABOUT_ROW_ICON_SIZE_PX),
            headerSuffix: loadButton,
        });
        group.add(placeholder);

        loadButton.connect('clicked', () => {
            group.remove(placeholder);
            this._loadContributors(group);
        });
    }

    async _loadContributors(group) {
        const spinner = new Adw.Spinner({visible: true});
        const loadingRow = createActionRow({title: _('Loading…'), headerSuffix: spinner});
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

            // Apply the opt-out filter before slicing, so an opted-out user
            // never displaces a visible contributor.
            data = _filterContributors(data);
            data.sort((a, b) => b.contributions - a.contributions);

            group.remove(loadingRow);

            if (data.length === 0) {
                const noContributorsLabel = createLabel(_('No contributors found'), ['dimmed'], {halign: 'center', margin_top: 12, margin_bottom: 12});
                group.add(noContributorsLabel);
                return;
            }

            const top = data.slice(0, MAX_CONTRIBUTORS);
            const cards = top.map(contributor => {
                const avatar = createAvatar({
                    size: CONTRIBUTOR_AVATAR_SIZE_PX,
                    text: contributor.login,
                    halign: 'center',
                });
                if (contributor.avatar_url)
                    this._loadAvatarImage(avatar, contributor.avatar_url);

                return createCard({
                    avatar,
                    title: contributor.login,
                    subtitle: `${contributor.contributions} ${_('commits')}`,
                    tooltip: contributor.login,
                    onActivate: () => _openUri(this.get_root(), contributor.html_url),
                });
            });

            if (data.length > MAX_CONTRIBUTORS) {
                const moreUrl = `${GIT_REPO_URL}/graphs/contributors`;
                cards.push(createCard({
                    iconName: 'bti-other-symbolic',
                    iconSize: SHOW_MORE_ICON_SIZE_PX,
                    title: _('Show more'),
                    tooltip: _('Open on GitHub'),
                    onActivate: () => _openUri(this.get_root(), moreUrl),
                }));
            }

            group.add(createCardRow({cards}));
        } catch (e) {
            error('Contributor loader crash', e);
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
}

function _filterContributors(list) {
    if (!Array.isArray(list))
        return [];
    return list.filter(contributor =>
        contributor && typeof contributor.login === 'string' &&
        !CONTRIBUTORS_OPTOUT.has(contributor.login.toLowerCase())
    );
}

function _appendRelease(list, release, withSeparator) {
    if (withSeparator)
        list.append(new Gtk.Separator({margin_start: 12, margin_end: 12}));

    const name = GLib.markup_escape_text(String(release.name || release.tag_name || ''), -1);
    list.append(createMarkdownView(release.body, `<span size="x-large" weight="bold">${name}</span>`));
}

// Each service takes one handle or a list of them, custom takes full URLs.
function _donationLinks(donations) {
    return Object.entries(donations)
        .flatMap(([key, value]) => [value].flat().map(entry => _donationLink(key, entry)))
        .filter(Boolean);
}

function _donationLink(key, entry) {
    if (key === 'custom')
        return _customDonationLink(entry);
    const service = DONATION_SERVICES[key];
    if (!service)
        return null;
    return {
        name: service.name,
        url: `${service.baseUrl}/${encodeURIComponent(entry)}`,
        iconName: service.iconName ?? LINK_ICON_NAME,
    };
}

function _customDonationLink(url) {
    const host = GLib.Uri.parse(url, GLib.UriFlags.NONE).get_host();
    const service = Object.values(DONATION_SERVICES)
        .find(({baseUrl}) => GLib.Uri.parse(baseUrl, GLib.UriFlags.NONE).get_host() === host);
    return {name: service?.name ?? host, url, iconName: service?.iconName ?? LINK_ICON_NAME};
}

function _openUri(parent, uri) {
    const launcher = new Gtk.UriLauncher({uri});
    launcher.launch(parent, null, null);
}
