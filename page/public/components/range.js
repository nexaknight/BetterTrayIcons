import {escapeHtml} from '../shared/util.js';

// libadwaita's GtkScale, which the shell's .slider draws the same way. The
// track paints the trough and the fill from its custom properties, so a
// drag only has to move --value.
export function rangeSlider(label, min, max, value, attributes = '') {
    return `<span class="pref-range-track" style="--min:${min};--max:${max};--value:${value}">` +
        `<input type="range" class="pref-range" min="${min}" max="${max}" value="${value}" aria-label="${escapeHtml(label)}" ${attributes}></span>`;
}

export function paintRange(input) {
    input.parentElement.style.setProperty('--value', input.value);
}
