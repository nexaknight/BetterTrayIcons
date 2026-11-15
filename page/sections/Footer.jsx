import {ExternalLink} from '../components/ExternalLink.jsx';
import {LICENSE_URL} from '../components/urls.js';

// A text run next to a {' '} would get a React comment marker inside the
// i18n key, so each run between two links is one string
export function Footer() {
    return (
        <footer className="footer wrap">
            <ul className="footer-credits" data-i18n="aria-label" aria-label="Disclaimer and credits">
                <li data-i18n="">
                    Inspired by <ExternalLink href="https://github.com/ubuntu/gnome-shell-extension-appindicator">AppIndicator</ExternalLink>
                    {', '}
                    <ExternalLink href="https://github.com/MartinPL/Tray-Icons-Reloaded">Tray Icons: Reloaded</ExternalLink>
                    {' by MartinPL and '}
                    <ExternalLink href="https://github.com/cassidyjames/background-app-icons">Background App Icons</ExternalLink> by cassidyjames.
                </li>
                <li data-i18n="">
                    DBus interface XML files come from the upstream specifications referenced by AppIndicator.
                </li>
                <li data-i18n="">
                    About-page layout inspired by <ExternalLink href="https://github.com/home-sweet-gnome/dash-to-panel">Dash to Panel</ExternalLink> by Home Sweet GNOME.
                </li>
                <li data-i18n="">
                    Preference icons: <ExternalLink href="https://github.com/lucide-icons/lucide">Lucide</ExternalLink>
                    {' (ISC), '}
                    <ExternalLink href="https://github.com/feathericons/feather">Feather</ExternalLink>
                    {' (MIT) by Cole Bemis and the Wine glyph from '}
                    <ExternalLink href="https://github.com/somepaulo/MoreWaita">MoreWaita</ExternalLink>
                    {' (GPL-3.0). '}
                    <a href="#explore" data-open-credits="">Full credits and licenses</a>
                </li>
            </ul>
            <div className="footer-legal">
                <p className="footer-license" data-i18n="">
                    {'Better Tray Icons is available under the terms of the '}
                    <ExternalLink href={LICENSE_URL}><strong>GPL v3 or later</strong></ExternalLink> license
                </p>
                <p className="footer-disclaimer" data-i18n="">
                    Provided “as is”, without warranty. The authors are not liable for damages.
                </p>
            </div>
            <span className="creator-credit">
                <span data-i18n="">Developed by</span>{' '}
                <ExternalLink
                    className="creator-logo"
                    href="https://github.com/nexaknight"
                    data-i18n="aria-label"
                    aria-label="NexaKnight on GitHub"
                >
                    <img
                        src="assets/logo.svg"
                        data-i18n="alt"
                        alt="NexaKnight knight logo"
                        width="126"
                        height="80"
                        loading="lazy"
                    />
                </ExternalLink>
            </span>
        </footer>
    );
}
