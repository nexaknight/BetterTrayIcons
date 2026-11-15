const HTML_ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

export function escapeHtml(text) {
    return text.replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

export async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`GitHub answered ${response.status}`);
    return response.json();
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}
