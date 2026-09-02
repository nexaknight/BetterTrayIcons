import GLib from 'gi://GLib';

// AppImage runtime basenames, the generic wrapper rather than the app, so every
// AppImage would collide on one id. The real name comes from the APPIMAGE env.
export const APPIMAGE_WRAPPERS = new Set(['apprun.wrapped', 'apprun']);

export const APP_ID_EXE_SUFFIX_RE = /\.exe$/i;

const APP_ID_INVALID_RE = /[^\p{L}\p{N}._-]+/gu;

const APP_ID_PID_SUFFIX_RE = /[-_](\d+)$/;

const REVERSE_DNS_ID_RE = /([a-z0-9-_]+\.[a-z0-9-_]+\.[a-z0-9-_]+)/i;

const ICON_NAME_ROLE_SUFFIX_RE = /[-_](symbolic|tray|panel)$/i;

const APP_ID_HASH_LENGTH = 8;

const MIN_ICON_NAME_LENGTH = 3;

const MULTI_WORD_TITLE_LIMIT = 20;

// APP_ID_INVALID_RE collapses '@' to a dash, so a plain id can never grow one
// on its own and a split key stays recognizable.
const APP_ID_SPLIT_SEPARATOR = '@';

// A dot would read as a reverse-DNS id and formatAppName would show only the
// last segment.
const PACKAGING_ID_SEPARATOR = '-';

// Battery and network icon names encode live state, so a Solaar restart on
// another charge level would otherwise mint a fresh id.
const STATEFUL_ICON_NAME_RE = /^(battery|network)[-_]/i;

export function sanitizeAppId(raw) {
    if (typeof raw !== 'string')
        return null;

    const trimmed = raw.trim();
    if (!trimmed)
        return null;

    const cleaned = trimmed.toLowerCase()
        .replace(APP_ID_EXE_SUFFIX_RE, '')
        .replace(APP_ID_INVALID_RE, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '');

    // An identity written purely in symbols sanitizes down to nothing, which
    // would leave the app unconfigurable and invisible in the prefs.
    return cleaned || `u-${_shortHash(trimmed)}`;
}

// The process is the identity of record, the SNI Id is only as good as the app
// that sets it. WARP randomises it per launch, OpenRGB reports its AppImage
// wrapper and Wooting ships a placeholder. Null keeps the item session-volatile
// rather than minting a bus-name key that changes on every restart.
export function pickAppId({processName, rawId, pid, iconThemePath, iconName, title, packaging}) {
    if (packaging)
        return sanitizeAppId(`${packaging.kind}${PACKAGING_ID_SEPARATOR}${packaging.id}`);

    const process = sanitizeAppId(processName);
    if (process)
        return process;

    const id = sanitizeAppId(_stripPidSuffix(rawId, pid));
    if (id && !_isGenericId(id))
        return id;

    if (iconThemePath) {
        const match = iconThemePath.match(REVERSE_DNS_ID_RE);
        if (match && !match[1].includes('freedesktop'))
            return sanitizeAppId(match[1]);
    }

    if (iconName && iconName.length >= MIN_ICON_NAME_LENGTH && !_isGenericIconName(iconName)) {
        const stripped = sanitizeAppId(iconName.replace(ICON_NAME_ROLE_SUFFIX_RE, ''));
        if (stripped && !_isGenericId(stripped))
            return stripped;
    }

    // A title carrying a counter changes on its own, and each spelling would
    // leave another dead entry behind.
    const titleIsStable = !!title && !/\d/.test(title) &&
        (!title.includes(' ') || title.length < MULTI_WORD_TITLE_LIMIT);
    if (titleIsStable) {
        const fromTitle = sanitizeAppId(title);
        if (fromTitle && !_isGenericId(fromTitle))
            return fromTitle;
    }

    return null;
}

export function joinSplitId(base, discriminator) {
    const suffix = sanitizeAppId(discriminator);
    return suffix ? `${base}${APP_ID_SPLIT_SEPARATOR}${suffix}` : base;
}

// A faithful replay of the scheme this release replaces, so an existing entry
// can be carried over instead of starting from defaults. It duplicates the
// rules above on purpose, sharing them is how this broke once. This describes a
// released artifact, so it is frozen. Do not "improve" it.
export function legacyAppId({legacyName, rawId, iconThemePath, iconName, title, busName}) {
    let candidate = null;
    if (legacyName) {
        candidate = legacyName;
    } else if (rawId && !_legacyIsGenericId(rawId)) {
        candidate = rawId;
    } else if (iconThemePath) {
        const match = iconThemePath.match(/([a-z0-9-_]+\.[a-z0-9-_]+\.[a-z0-9-_]+)/i);
        if (match && !match[1].includes('freedesktop'))
            candidate = match[1];
    }
    if (!candidate && iconName && iconName.length > 2 && !_legacyIsGenericIconName(iconName)) {
        const stripped = iconName.replace(/[-_](symbolic|tray|panel)$/i, '');
        if (!_legacyIsGenericId(stripped))
            candidate = stripped;
    }
    if (!candidate && title && (!title.includes(' ') || title.length < 20))
        candidate = title;

    const raw = candidate ?? rawId ?? busName?.replace(/[:.]/g, '_');
    return raw
        ? raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-._]/g, '')
        : null;
}

export function pickDisplayTitle({title, processName, appId, busName}) {
    const titleIsWrapper = title && APPIMAGE_WRAPPERS.has(title.split('/').pop().toLowerCase());
    return (titleIsWrapper ? processName : title) ?? appId ?? busName;
}

function _isGenericId(id) {
    const lower = id.toLowerCase();
    return APPIMAGE_WRAPPERS.has(lower) ||
        lower.includes('chrome_status_icon') ||
        lower.includes('status_icon') ||
        lower.includes('indicator') ||
        lower.startsWith('state-') ||
        lower.startsWith('libappindicator') ||
        lower.startsWith('task-') ||
        lower === 'app';
}

function _isGenericIconName(name) {
    const lower = name.toLowerCase();
    return lower.startsWith('state-') ||
        lower.startsWith('sync-') ||
        lower === 'image-missing' ||
        lower.includes('panel') ||
        STATEFUL_ICON_NAME_RE.test(lower);
}

// Apps that append their own pid to the Id (Dropbox) would otherwise look like
// a different app on every launch.
function _stripPidSuffix(rawId, pid) {
    if (!rawId || !pid)
        return rawId;
    const match = rawId.match(APP_ID_PID_SUFFIX_RE);
    return match && match[1] === String(pid) ? rawId.slice(0, match.index) : rawId;
}

function _shortHash(value) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, value, -1)
        .slice(0, APP_ID_HASH_LENGTH);
}

function _legacyIsGenericId(id) {
    if (!id)
        return true;
    const lower = id.toLowerCase();
    return lower.includes('chrome_status_icon') ||
        lower.includes('status_icon') ||
        lower.includes('indicator') ||
        lower.startsWith('state-') ||
        lower.startsWith('libappindicator') ||
        lower.startsWith('task-') ||
        lower === 'app';
}

function _legacyIsGenericIconName(name) {
    if (!name)
        return true;
    const lower = name.toLowerCase();
    return lower.startsWith('state-') ||
        lower.startsWith('sync-') ||
        lower === 'image-missing' ||
        lower.includes('panel');
}
