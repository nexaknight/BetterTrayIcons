import {Button, InstallButton} from '../components/Button.jsx';
import {CheckRow} from '../components/CheckRow.jsx';
import {ExternalLink} from '../components/ExternalLink.jsx';
import {Icon, action} from '../components/Icon.jsx';
import {REPO_URL} from '../components/urls.js';

const GUIDE_URL = `${REPO_URL}/wiki/Installation`;
const EXTENSION_MANAGER_URL = 'https://flathub.org/apps/com.mattjakeman.ExtensionManager';
const REQUIREMENTS = [
    ['A Wayland session', 'X11 sessions are not supported.'],
    ['One tray extension at a time', 'Disable other tray or AppIndicator extensions first.'],
];

export function Install() {
    return (
        <section className="install-section wrap" id="install">
            <div className="install-copy">
                <h2 data-i18n="">Get Better Tray Icons</h2>
                <p data-i18n="">Install the extension now and take back control of your tray icons.</p>
                <InstallButton title="Install from GNOME Extensions" />
                <a className="source-install" data-i18n="" data-guide-open="" href={GUIDE_URL}>
                    Build from source? <span>Installation Guide</span>
                </a>
            </div>
            <div className="before-install">
                <div className="install-check-heading">
                    <span className="check-circle"><Icon src={action('select')} /></span>
                    <h3 data-i18n="">Before you install</h3>
                </div>
                <ul>
                    <CheckRow>
                        <span>
                            <span data-i18n="">A supported GNOME Shell version</span>{' '}
                            <small>
                                <span data-i18n="">This build: 49, 50 and 51.</span>{' '}
                                <Button
                                    as="button"
                                    type="button"
                                    className="compat-open"
                                    aria-haspopup="dialog"
                                    data-compat-open=""
                                    data-i18n=""
                                    title="Check Compatibility"
                                />
                            </small>
                        </span>
                    </CheckRow>
                    {REQUIREMENTS.map(([requirement, detail]) => (
                        <CheckRow key={requirement}><span data-i18n="">{requirement}<small>{detail}</small></span></CheckRow>
                    ))}
                </ul>
                <p data-i18n="">
                    Using <ExternalLink href={EXTENSION_MANAGER_URL}>Extension Manager</ExternalLink>? Search for <strong>Better Tray Icons</strong>.
                </p>
            </div>
        </section>
    );
}
