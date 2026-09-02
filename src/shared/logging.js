const LOG_PREFIX = '[BetterTrayIcons] ';

const _warnedKeys = new Set();

export function warn(msg) {
    console.warn(`${LOG_PREFIX}${msg}`);
}

export function warnOnce(key, msg) {
    if (_warnedKeys.has(key))
        return;
    _warnedKeys.add(key);
    warn(msg);
}

export function error(msg, e) {
    if (e)
        logError(e, `${LOG_PREFIX}${msg}`);
    else
        console.error(`${LOG_PREFIX}${msg}`);
}

// Without this, a re-enable stays silent on problems it already warned
// about in the previous session.
export function clearWarnedOnce() {
    _warnedKeys.clear();
}
