import {toastElement} from './window.js';
import {ui} from '../shared/store.js';

const TOAST_MS = 2800;

let toastTimer = 0;

export function toast(message) {
    if (ui.isDoNotDisturb)
        return;
    toastElement.textContent = message;
    toastElement.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastElement.hidden = true), TOAST_MS);
}
