import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {error} from '../../shared/logging.js';
import {disconnectAll} from '../../shared/lifecycle.js';
import {fetchJson, fetchBytes} from '../../shared/fetch.js';
import {createLabel, createBox, createPicture, createAvatar, createCard, createCardRow, createTextureFromBytes, createButton} from '../widgets/gtkHelpers.js';
import {createActionRow, createLinkRow} from '../widgets/rows.js';
import {bindLogoToTheme, bindSvgIconToTheme} from '../widgets/theme.js';
import {openUri, showTextDialog} from '../dialogs/dialogs.js';
import {GIT_REPO_URL, LICENSE_URL, SPONSOR_URL, TRANSLATE_URL, MAX_CONTRIBUTORS, CONTRIBUTORS_OPTOUT} from '../../const.js';

const _contributorOptOutSet = new Set(CONTRIBUTORS_OPTOUT.map(n => n.toLowerCase()));

function filterContributors(list) {
    if (!Array.isArray(list))
        return [];
    return list.filter(c =>
        c && typeof c.login === 'string' && !_contributorOptOutSet.has(c.login.toLowerCase())
    );
}

export class AboutPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    _init(extensionDir, metadata, settings) {
        super._init({
            title: _('About'),
            icon_name: 'help-about-symbolic',
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
        const mediaDir = this._extensionDir.get_child('media');
        const translateBanner = new Adw.Banner({
            title: _('Help translate this extension.'),
            button_label: _('Translate'),
            revealed: true,
        });
        translateBanner.connect('button-clicked', () => {
            new Gtk.UriLauncher({uri: TRANSLATE_URL}).launch(this.get_root(), null, null);
        });
        this.set_banner(translateBanner);

        const infoGroup = new Adw.PreferencesGroup({title: _('Information')});
        this.add(infoGroup);

        const versionLabel = createLabel(String(this._metadata.version ?? 'dev'));
        const versionRow = createActionRow(_('Version'), '', {
            prefixIcon: 'tag-symbolic',
            headerSuffix: versionLabel,
        });
        infoGroup.add(versionRow);

        const githubBox = createBox({orientation: 'horizontal', spacing: 6, valign: 'center', halign: 'end'});

        const githubIcon = createPicture({
            width_request: 18,
            height_request: 18,
            valign: 'center',
            tooltip_text: _('Open on GitHub'),
            content_fit: 2, // Gtk.ContentFit.CONTAIN
        });

        this._themeSignals.push(bindSvgIconToTheme(githubIcon, mediaDir, 'github-icon.svg', 18));

        githubBox.append(githubIcon);
        githubBox.append(createLabel('Github', []));

        const sourceRow = createActionRow(_('Source Code'), '', {
            prefixIcon: 'applications-development-symbolic',
            headerSuffix: githubBox,
            onActivate: () => openUri(this.get_root(), GIT_REPO_URL),
        });
        infoGroup.add(sourceRow);

        const changelogRow = createActionRow(
            _('Changelog'),
            _('Recent releases'),
            {
                prefixIcon: 'document-open-recent-symbolic',
                onActivate: () => this._fetchAndShowChangelog(),
            }
        );
        infoGroup.add(changelogRow);

        const donationRow = createActionRow(
            _('Sponsor'),
            _('Support development.'),
            {
                prefixIcon: 'emblem-favorite-symbolic',
                suffixIcon: 'link-symbolic',
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

        legalGroup.add(createLinkRow(_('License'), '', 'text-x-generic-symbolic', this.get_root(), LICENSE_URL));

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
            content_fit: 2, // Gtk.ContentFit.CONTAIN
            width_request: 160,
            height_request: 160,
            halign: 'center',
            visible: false,
        });

        const fallbackLabel = createLabel('BetterTrayIcons', ['display-3', 'dim-label'], {visible: false});

        footerBox.append(logo);
        footerBox.append(fallbackLabel);

        this._themeSignals.push(bindLogoToTheme(logo, fallbackLabel, mediaDir, 'logo.svg'));

        creditsGroup.add(footerBox);
    }

    async _fetchAndShowChangelog() {
        try {
            const repoMatch = GIT_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (!repoMatch)
                throw new Error('Invalid Repo URL');

            const apiUrl = `https://api.github.com/repos/${repoMatch[1]}/${repoMatch[2]}/releases`;
            const releases = await fetchJson(apiUrl, this._cancellable);

            let text = '';
            if (Array.isArray(releases) && releases.length > 0) {
                // Escape per release so a maintainer-controlled body can't break
                // out into Pango markup the GtkLabel would refuse to render.
                const escape = s => GLib.markup_escape_text(String(s ?? ''), -1);
                releases.forEach(r => {
                    text += `<b>${escape(r.name || r.tag_name)}</b>\n`;
                    text += `${escape(r.body)}\n\n`;
                });
            } else {
                text = _('No releases found.');
            }

            showTextDialog(this.get_root(), _('Changelog'), text);
        } catch (e) {
            if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            error('Failed to fetch changelog', e);
            showTextDialog(this.get_root(), _('Changelog'), _('Failed to load changelog: ') + e.message);
        }
    }

    // Network access is opt-in. Defer the fetch until the user clicks.
    _setupContributorsLoader(group) {
        const loadBtn = createButton({
            label: _('Load'),
            cssClasses: ['suggested-action'],
            valign: 'center',
        });

        const placeholder = createActionRow(
            _('Loaded from GitHub'),
            _('Contacts api.github.com on demand.'),
            {prefixIcon: 'system-users-symbolic', headerSuffix: loadBtn}
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
            const repoMatch = GIT_REPO_URL.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (!repoMatch)
                throw new Error('Invalid Repo URL');

            const apiUrl = `https://api.github.com/repos/${repoMatch[1]}/${repoMatch[2]}/contributors`;
            let data = [];
            try {
                data = await fetchJson(apiUrl, this._cancellable);
            } catch (e) {
                if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                // Network errors or rate limits: keep the UI quiet.
                error(`Failed to fetch contributors: ${e.message}`);
            }

            group.remove(loadingRow);

            // Apply the opt-out filter before slicing, so an opted-out user
            // never displaces a visible contributor from the top 5.
            data = filterContributors(data);

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
                    subtitle: `${c.contributions} commits`,
                    tooltip: c.login,
                    onActivate: () => openUri(this.get_root(), c.html_url),
                });
            });

            if (data.length > MAX_CONTRIBUTORS) {
                const moreUrl = `${GIT_REPO_URL.replace(/\.git$/, '')}/graphs/contributors`;
                cards.push(createCard({
                    iconName: 'application-other-symbolic',
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
            if (e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
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
