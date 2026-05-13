import {LOG_PREFIX} from '../const.js';

export function warn(msg) {
    console.warn(`${LOG_PREFIX}${msg}`);
}

export function error(msg, e) {
    if (e)
        logError(e, `${LOG_PREFIX}${msg}`);
    else
        console.error(`${LOG_PREFIX}${msg}`);
}
