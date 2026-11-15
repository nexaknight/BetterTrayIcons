import {openSurpriseDialog} from './surpriseDialog.js';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const OPENING_UPS = 2;

let progress = 0;

// Listens without preventDefault, so the demo's own arrow keys keep working.
// Typing in a text field never counts.
export function onKonamiKey(event) {
    const isTextField = event.target.closest?.('input,textarea,[contenteditable]');
    if (isTextField)
        return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    progress = key === KONAMI[progress] ? progress + 1 : restartAt(key);
    if (progress < KONAMI.length)
        return;
    progress = 0;
    openSurpriseDialog();
}

// A third Up keeps the last two as the code's start
function restartAt(key) {
    if (key !== KONAMI[0])
        return 0;
    return progress === OPENING_UPS ? OPENING_UPS : 1;
}
