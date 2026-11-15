// The files page/tools/po2json.py writes from po/, named after the po files
const LANGUAGES = ['de', 'it', 'ru', 'zh_CN'];
// Catalogs from page/po for the strings only the site shows
const PAGE_LANGUAGES = ['de'];

const language = pickLanguage(navigator.languages);
// Top-level await, so modules that translate at load time see the strings
const translations = language ? await loadTranslations(language) : {};

// The landing copy follows only where the page has a catalog of its own
export const pageLanguage = PAGE_LANGUAGES.includes(language) ? language : null;

export function _(msgid) {
    return translations[msgid] || msgid;
}

function pickLanguage(preferred) {
    for (const tag of preferred) {
        const [base, region] = tag.split('-');
        const regional = region ? `${base}_${region.toUpperCase()}` : '';
        const match = [regional, base].find(candidate => LANGUAGES.includes(candidate));
        if (match)
            return match;
    }
    return null;
}

// The extension's own translation wins where both catalogs carry a string
async function loadTranslations(code) {
    const [extension, page] = await Promise.all([
        readCatalog(`../i18n/${code}.json`),
        PAGE_LANGUAGES.includes(code) ? readCatalog(`../i18n/page.${code}.json`) : {},
    ]);
    return {...page, ...extension};
}

async function readCatalog(path) {
    try {
        const response = await fetch(new URL(path, import.meta.url));
        return response.ok ? await response.json() : {};
    } catch {
        return {};
    }
}
