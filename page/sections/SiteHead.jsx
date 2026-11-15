import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {EGO_URL, LICENSE_URL, REPO_URL} from '../components/urls.js';

const SITE_URL = 'https://bti.nexaknight.com/';
const SHARE_IMAGE = `${SITE_URL}media/screenshots/landing-page.png`;
const SHARE_TITLE = 'Better Tray Icons | System tray icons for GNOME Shell';
const SHARE_DESCRIPTION = 'A free, open source GNOME Shell extension that brings system tray icons back to the top panel on Wayland.';

// Release Please bumps version-name in metadata.json, the page follows it
const {'version-name': VERSION} = JSON.parse(readFileSync(join(process.cwd(), '..', 'metadata.json'), 'utf8'));

const STRUCTURED_DATA = {
    '@context': 'https://schema.org',
    '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
    name: 'Better Tray Icons',
    description: 'Brings tray icons back to the GNOME panel. Supports the StatusNotifierItem (SNI) and KStatusNotifierItem specs, so apps like Discord, Steam, Telegram, Signal and Nextcloud show up in the panel like they used to.',
    url: SITE_URL,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Linux (GNOME Shell 49, 50, 51)',
    softwareVersion: VERSION,
    license: LICENSE_URL,
    codeRepository: REPO_URL,
    downloadUrl: EGO_URL,
    image: SHARE_IMAGE,
    author: {'@type': 'Person', name: 'NexaKnight', url: 'https://github.com/nexaknight'},
    offers: {'@type': 'Offer', price: '0', priceCurrency: 'USD'},
};

// Runs before the first paint, so neither the theme nor the German copy flashes
const BOOT_SCRIPT = `
try {
    const t = localStorage.getItem("bti-site-theme-v2");
    if (t === "light") document.documentElement.dataset.theme = "light";
} catch {}
// app.js swaps the copy to German, so it stays hidden until then
if (navigator.languages.some((tag) => tag.startsWith("de"))) {
    document.documentElement.classList.add("i18n-pending");
    setTimeout(() => document.documentElement.classList.remove("i18n-pending"), 3000);
}`;

// Firefox resolves a url() inside a custom property against the sheet that
// reads it, so the masks fed by the markup's paths live in the page itself
const DOCUMENT_STYLE = `
.i18n-pending body {
    visibility: hidden;
}
svg.bti {
    -webkit-mask: var(--bti) center/contain no-repeat;
    mask: var(--bti) center/contain no-repeat;
}
.prefs-native .pref-icon,
.ui-expander-arrow {
    -webkit-mask: var(--pref-icon) center/contain no-repeat;
    mask: var(--pref-icon) center/contain no-repeat;
}`;

export function SiteHead() {
    return (
        <>
            <meta
                data-i18n="content"
                name="description"
                content="Better Tray Icons is a free, open source GNOME Shell extension that brings system tray icons back to the top panel on Wayland, with an overflow popup, per-app settings and sync."
            />
            <meta name="bti-version" content={VERSION} />
            <meta name="color-scheme" content="dark light" />
            {/* The --accent of styles/landing/_base.scss in each theme */}
            <meta name="theme-color" content="#5896da" media="(prefers-color-scheme: dark)" />
            <meta name="theme-color" content="#326db1" media="(prefers-color-scheme: light)" />
            <link rel="canonical" href={SITE_URL} />
            <meta property="og:type" content="website" />
            <meta property="og:url" content={SITE_URL} />
            <meta property="og:site_name" content="Better Tray Icons" />
            <meta property="og:title" content={SHARE_TITLE} />
            <meta property="og:description" content={SHARE_DESCRIPTION} />
            <meta property="og:image" content={SHARE_IMAGE} />
            <meta property="og:image:width" content="1910" />
            <meta property="og:image:height" content="940" />
            <meta property="og:image:alt" content="The Better Tray Icons landing page with tray icons in the GNOME top panel" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={SHARE_TITLE} />
            <meta name="twitter:description" content={SHARE_DESCRIPTION} />
            <meta name="twitter:image" content={SHARE_IMAGE} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(STRUCTURED_DATA)}} />
            <script dangerouslySetInnerHTML={{__html: BOOT_SCRIPT}} />
            <link rel="icon" href="assets/icon.png" />
            <style dangerouslySetInnerHTML={{__html: DOCUMENT_STYLE}} />
            {/* build.sh compiles styles/site.scss with the sass CLI. Next's own CSS
                pipeline would rewrite colors and reorder declarations. */}
            <link rel="stylesheet" href="css/site.css" />
            <link rel="preload" href="assets/fonts/AdwaitaSans.ttf" as="font" type="font/ttf" crossOrigin="" />
        </>
    );
}
