import {_} from '../shared/i18n.js';
import {CHANNEL_MAX, parseColor} from '../shared/color.js';
import {clamp} from '../shared/util.js';

// A recreation of the editor view of GtkColorChooserWidget, which the "+" of
// the Custom row opens
const HUE_MAX = 360;
const KEY_STEP = 1;
const KEY_STEP_LARGE = 10;
const ALPHA_DECIMALS = 3;
const WHITE = {red: 1, green: 1, blue: 1, alpha: 1};
const KEY_DIRECTIONS = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};

let editor = null;

export function colorEditorMarkup(value) {
    editor = rgbaToHsva(parseColor(value) ?? WHITE);
    return '<div class="pref-color-editor">' +
        '<span class="pref-color-editor-entry"><span class="pref-color-editor-swatch" aria-hidden="true"></span>' +
        `<input class="pref-input" data-editor-entry aria-label="${_('Color')}" spellcheck="false"></span>` +
        `<div class="pref-color-editor-hue" role="slider" tabindex="0" aria-label="${_('Hue')}" aria-valuemin="0" aria-valuemax="${HUE_MAX}" data-editor-control="hue"><span class="pref-color-editor-thumb"></span></div>` +
        `<div class="pref-color-editor-plane" role="slider" tabindex="0" aria-label="${_('Saturation and value')}" data-editor-control="plane"><span class="pref-color-editor-cross-x"></span><span class="pref-color-editor-cross-y"></span></div>` +
        `<div class="pref-color-editor-alpha" role="slider" tabindex="0" aria-label="${_('Alpha')}" aria-valuemin="0" aria-valuemax="100" data-editor-control="alpha"><span class="pref-color-editor-thumb"></span></div>` +
        '</div>';
}

export function bindColorEditor(element) {
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('keydown', onKey);
    element.addEventListener('change', onEntry);
    paint(element);
}

// rgb() and rgba() as Gdk.RGBA.to_string writes them for the settings
export function editorValue() {
    const {red, green, blue, alpha} = hsvaToRgba(editor);
    const channels = [red, green, blue].map(channel => Math.round(channel * CHANNEL_MAX)).join(',');
    return alpha < 1 ? `rgba(${channels},${Number(alpha.toFixed(ALPHA_DECIMALS))})` : `rgb(${channels})`;
}

function onPointerDown(event) {
    const control = event.target.closest('[data-editor-control]');
    if (!control)
        return;
    event.preventDefault();
    control.focus({preventScroll: true});
    control.setPointerCapture(event.pointerId);
    const move = moveEvent => pointAt(control, moveEvent);
    const stop = () => {
        control.removeEventListener('pointermove', move);
        control.removeEventListener('pointerup', stop);
        control.removeEventListener('pointercancel', stop);
    };
    control.addEventListener('pointermove', move);
    control.addEventListener('pointerup', stop);
    control.addEventListener('pointercancel', stop);
    pointAt(control, event);
}

function pointAt(control, event) {
    const box = control.getBoundingClientRect();
    const x = clamp((event.clientX - box.left) / box.width, 0, 1);
    const y = clamp((event.clientY - box.top) / box.height, 0, 1);
    const kind = control.dataset.editorControl;
    if (kind === 'hue')
        editor.hue = y * HUE_MAX;
    else if (kind === 'alpha')
        editor.alpha = x;
    else
        Object.assign(editor, {saturation: x, value: 1 - y});
    paint(control.closest('.pref-color-editor'));
}

function onKey(event) {
    const control = event.target.closest('[data-editor-control]');
    if (!control || !KEY_DIRECTIONS[event.key])
        return;
    event.preventDefault();
    event.stopPropagation();
    const size = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const [dx, dy] = KEY_DIRECTIONS[event.key];
    const kind = control.dataset.editorControl;
    if (kind === 'hue')
        editor.hue = clamp(editor.hue + (dy || dx) * size, 0, HUE_MAX);
    else if (kind === 'alpha')
        editor.alpha = clamp(editor.alpha + (dx || -dy) * size / 100, 0, 1);
    else
        Object.assign(editor, {saturation: clamp(editor.saturation + dx * size / 100, 0, 1), value: clamp(editor.value - dy * size / 100, 0, 1)});
    paint(control.closest('.pref-color-editor'));
}

function onEntry(event) {
    if (!event.target.matches('[data-editor-entry]'))
        return;
    const rgba = parseColor(event.target.value.trim());
    if (rgba)
        editor = rgbaToHsva(rgba);
    paint(event.target.closest('.pref-color-editor'));
}

function paint(element) {
    const {hue, saturation, value, alpha} = editor;
    const rgba = hsvaToRgba(editor);
    const opaque = `rgb(${[rgba.red, rgba.green, rgba.blue].map(channel => Math.round(channel * CHANNEL_MAX)).join(' ')})`;
    element.style.setProperty('--editor-hue', `hsl(${hue} 100% 50%)`);
    element.style.setProperty('--editor-opaque', opaque);
    element.style.setProperty('--editor-color', editorValue());
    element.style.setProperty('--editor-hue-y', `${hue / HUE_MAX * 100}%`);
    element.style.setProperty('--editor-x', `${saturation * 100}%`);
    element.style.setProperty('--editor-y', `${(1 - value) * 100}%`);
    element.style.setProperty('--editor-alpha-x', `${alpha * 100}%`);
    element.querySelector('[data-editor-control="hue"]').setAttribute('aria-valuenow', String(Math.round(hue)));
    element.querySelector('[data-editor-control="alpha"]').setAttribute('aria-valuenow', String(Math.round(alpha * 100)));
    element.querySelector('[data-editor-control="plane"]').setAttribute('aria-valuetext', `${Math.round(saturation * 100)} %, ${Math.round(value * 100)} %`);
    const entry = element.querySelector('[data-editor-entry]');
    if (document.activeElement !== entry)
        entry.value = hexOf(rgba);
}

function hexOf({red, green, blue, alpha}) {
    const channels = alpha < 1 ? [red, green, blue, alpha] : [red, green, blue];
    return `#${channels.map(channel => Math.round(channel * CHANNEL_MAX).toString(16).padStart(2, '0')).join('')}`;
}

function rgbaToHsva({red, green, blue, alpha}) {
    const max = Math.max(red, green, blue);
    const delta = max - Math.min(red, green, blue);
    let hue = 0;
    if (delta && max === red)
        hue = 60 * (((green - blue) / delta + 6) % 6);
    else if (delta && max === green)
        hue = 60 * ((blue - red) / delta + 2);
    else if (delta)
        hue = 60 * ((red - green) / delta + 4);
    return {hue, saturation: max ? delta / max : 0, value: max, alpha};
}

function hsvaToRgba({hue, saturation, value, alpha}) {
    const channel = offset => {
        const k = (offset + hue / 60) % 6;
        return value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return {red: channel(5), green: channel(3), blue: channel(1), alpha};
}
