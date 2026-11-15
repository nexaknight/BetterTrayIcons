const THEME_STORAGE_KEY = 'bti-site-theme-v2';

// Dark stays the default, the system color scheme does not override it
export function toggleTheme() {
    const next = isDarkTheme() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
        // Blocked storage only loses the choice for the next visit
    }
}

export function isDarkTheme() {
    return document.documentElement.dataset.theme !== 'light';
}
