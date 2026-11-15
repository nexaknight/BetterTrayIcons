// Rebuilds the README donation badges from metadata.json.
// With --check it only compares and fails when the block is stale.
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {DONATION_SERVICES} from '../src/const.js';

const ROOT_DIR = path.join(import.meta.dirname, '..');
const README_PATH = path.join(ROOT_DIR, 'README.md');
const METADATA_PATH = path.join(ROOT_DIR, 'metadata.json');
const START_MARKER = '<!-- donations:start -->';
const END_MARKER = '<!-- donations:end -->';
const SHIELDS_BADGE_URL = 'https://img.shields.io/badge';
const BADGE_STYLE = 'style=for-the-badge';
const FALLBACK_BADGE_COLOR = '555555';

// Brand badges for the README only, keyed like DONATION_SERVICES.
// A service missing here still gets a plain badge with its name.
const BRAND_BADGES = Object.freeze({
    github: {label: 'GitHub Sponsors', color: 'EA4AAA', logo: 'githubsponsors', logoColor: 'white'},
    buymeacoffee: {label: 'Buy Me a Coffee', color: 'FFDD00', logo: 'buymeacoffee', logoColor: 'black'},
});

const isCheck = process.argv.includes('--check');
const {donations = {}} = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const readme = readFileSync(README_PATH, 'utf8');

const start = readme.indexOf(START_MARKER);
const end = readme.indexOf(END_MARKER);
if (start < 0 || end < start)
    throw new Error(`README.md needs ${START_MARKER} before ${END_MARKER}`);

const updated = readme.slice(0, start) + buildBlock(donations) + readme.slice(end + END_MARKER.length);

if (updated === readme) {
    process.stdout.write('README donations are up to date\n');
} else if (isCheck) {
    process.stderr.write('README donations are stale, run npm run readme\n');
    process.exitCode = 1;
} else {
    writeFileSync(README_PATH, updated);
    process.stdout.write('README donations updated\n');
}

function buildBlock(accounts) {
    const badges = Object.entries(accounts).map(donationBadge);
    return [START_MARKER, '<p align="center">', ...badges, '</p>', END_MARKER].join('\n');
}

function donationBadge([serviceId, account]) {
    const service = DONATION_SERVICES[serviceId];
    if (!service)
        throw new Error(`metadata.json names unknown donation service '${serviceId}'`);

    const href = `${service.baseUrl}/${account}`;
    return `  <a href="${href}"><img alt="${service.name}" src="${badgeUrl(serviceId, service.name)}"></a>`;
}

function badgeUrl(serviceId, serviceName) {
    const brand = BRAND_BADGES[serviceId];
    if (!brand)
        return `${SHIELDS_BADGE_URL}/${shieldsText(serviceName)}-${FALLBACK_BADGE_COLOR}?${BADGE_STYLE}`;

    const logo = `logo=${brand.logo}&logoColor=${brand.logoColor}`;
    return `${SHIELDS_BADGE_URL}/${shieldsText(brand.label)}-${brand.color}?${BADGE_STYLE}&${logo}`;
}

// Shields reads dashes and underscores in the path as separators
function shieldsText(text) {
    return encodeURIComponent(text.replaceAll('-', '--').replaceAll('_', '__'));
}
