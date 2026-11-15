// The demo keeps its settings in this browser's localStorage, like the site
// theme. Nothing leaves the browser. A new version drops what an older page
// stored, a blocked or broken storage reads as empty.
const STORAGE_KEY = 'bti-site-demo';
const STORAGE_VERSION = 1;
const SAVE_DELAY_MS = 200;

let saveTimer = 0;
let collectSnapshot = null;

export function readSnapshot() {
    try {
        const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        return snapshot?.version === STORAGE_VERSION ? snapshot : null;
    } catch {
        return null;
    }
}

// The store hands in how to collect what it keeps, so this module holds no
// second copy of the shape
export function bindSnapshot(collect) {
    collectSnapshot = collect;
    // Only a change still waiting goes out on leaving, so storage cleared
    // by hand stays cleared through the reload
    globalThis.addEventListener('pagehide', () => {
        if (saveTimer)
            saveNow();
    });
}

export function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!collectSnapshot)
        return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({version: STORAGE_VERSION, ...collectSnapshot()}));
    } catch {
        // Blocked or full storage only loses the state for the next visit
    }
}
