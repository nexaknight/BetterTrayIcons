import {Button, InstallButton} from '../components/Button.jsx';
import {ExternalLink} from '../components/ExternalLink.jsx';
import {Icon, action} from '../components/Icon.jsx';
import {SystemIcons} from '../components/SystemIcons.jsx';
import {OverflowPopup, TrayToggle} from '../components/Tray.jsx';
import {REPO_URL} from '../components/urls.js';

const DONATE_LINKS = [
    {href: 'https://buymeacoffee.com/nexaknight', icon: 'buymeacoffee', className: 'coffee-icon', label: 'Buy Me a Coffee'},
    {href: 'https://github.com/sponsors/nexaknight', icon: 'github', label: 'GitHub Sponsors'},
];

export function Hero() {
    return (
        <section className="hero" data-i18n="aria-label" aria-label="Interactive desktop landing page">
            <div className="desktop-showcase">
                <div className="desktop landing-desktop" id="desktop" data-demo-side="left">
                    <div className="wallpaper">
                        <div className="orb orb-one" />
                        <div className="orb orb-two" />
                        <div className="orb orb-three" />
                        <div className="wallpaper-grain" />
                    </div>
                    <Panel />
                    <OverflowPopup id="overflow" data-i18n="aria-label" aria-label="Overflow tray" />
                    <div
                        className="quick-settings"
                        id="quick-settings"
                        role="dialog"
                        data-i18n="aria-label"
                        aria-label="Quick Settings"
                        hidden
                    />
                    <div className="hero-layout">
                        <div className="hero-demo" id="explore">
                            <div className="prefs-window-stage" id="prefs-window-stage">
                                <div id="prefs-mount" />
                            </div>
                        </div>
                        <HeroCopy />
                    </div>
                </div>
            </div>
        </section>
    );
}

function Panel() {
    return (
        <div className="panel" data-indicator-position="right">
            <div className="panel-box panel-left" id="panel-left">
                <div className="activities" data-i18n="aria-label" aria-label="Workspace indicator">
                    <span /><span className="is-active" /><span />
                </div>
            </div>
            <div className="panel-box panel-center" id="panel-center">
                <time className="panel-date" id="panel-clock" />
            </div>
            <div className="panel-box panel-right" id="panel-right">
                <div className="bti-indicator" id="bti-indicator">
                    <div className="tray-inline" id="tray-inline" />
                    <div className="tray-drawer" id="tray-drawer" hidden>
                        <div className="tray-drawer-icons" id="tray-drawer-icons" />
                    </div>
                    <TrayToggle
                        id="tray-toggle"
                        label="Show more tray icons"
                        popup="overflow"
                        isExpanded
                        leading={<span>•••</span>}
                    />
                </div>
                <Button
                    as="button"
                    type="button"
                    className="panel-system"
                    id="panel-system"
                    data-i18n="aria-label"
                    aria-label="System menu"
                    aria-haspopup="dialog"
                    aria-expanded="false"
                    aria-controls="quick-settings"
                    leading={<SystemIcons />}
                />
            </div>
        </div>
    );
}

function HeroCopy() {
    return (
        <div className="desktop-center">
            <h1 data-i18n="">Bring <span className="highlight">tray icons</span> back to GNOME</h1>
            <p className="hero-copy" data-i18n="">
                Full control, tailored to your needs and your style. Tray icons have never been better.
            </p>
            <div className="hero-actions">
                <InstallButton title="Install Extension" />
                <details className="donate-menu" id="donate-menu">
                    <Button
                        as="summary"
                        className="donate-button"
                        data-i18n="aria-label"
                        aria-label="Donate"
                        leading={<Icon src={action('heart')} />}
                    />
                    <div className="donate-options">
                        {DONATE_LINKS.map(link => (
                            <ExternalLink key={link.href} href={link.href}>
                                <Icon className={link.className} src={action(link.icon)} />
                                <span>{link.label}</span>
                                <span aria-hidden="true">↗</span>
                            </ExternalLink>
                        ))}
                    </div>
                </details>
            </div>
            <div className="compatibility" data-i18n="aria-label" aria-label="Project details">
                <ExternalLink
                    className="hero-badge"
                    href={REPO_URL}
                    data-i18n="aria-label"
                    aria-label="Free and open source, view on GitHub"
                >
                    <Icon src={action('github')} />
                    <span data-i18n="">Free and Open Source</span>
                </ExternalLink>
                <span className="hero-badge">
                    <span className="badge-dot" aria-hidden="true" />
                    <span data-i18n="">Wayland Only</span>
                </span>
            </div>
        </div>
    );
}
