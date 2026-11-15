import {groupSection} from './group.js';
import {helpButton} from './help.js';
import {state} from '../shared/store.js';
import {buttonMarkup} from './button.js';

export function cardGroup(title, description, cards) {
    return groupSection(title, `<div class="pref-card-strip"><div class="pref-card-row">${cards}</div></div>`, description);
}

// The caption sits outside the toggle so a help button beside it is never a
// button inside a button, _createChoiceCard in src/prefs/components/card.js
export function choiceCard({key, value, label, scene, help = '', isBleed = true}) {
    const isPicked = state[key] === value;
    return `<div class="pref-choice-card">${buttonMarkup({variant: `pref-choice ${isBleed ? 'bleed' : ''}`, leading: `<span class="pref-choice-scene">${scene}</span>`, label, attributes: `data-pref-set="${key}" data-value="${value}" aria-pressed="${isPicked}"`})}` +
        `<span class="pref-choice-title"><span class="pref-choice-caption" data-card-pick="${key}" data-value="${value}">${label}</span>${help ? helpButton(help, true) : ''}</span></div>`;
}

// A vertical wheel scrolls a card strip sideways until it hits the end it
// moves toward, then the page takes over, _scrollWheelSideways in
// src/prefs/components/card.js
export function onStripWheel(event) {
    const strip = event.target.closest('.pref-card-strip');
    if (!strip || event.deltaY === 0)
        return;
    const isAtStart = strip.scrollLeft <= 0;
    const isAtEnd = strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1;
    const isPastEnd = (event.deltaY > 0 && isAtEnd) || (event.deltaY < 0 && isAtStart);
    if (isPastEnd)
        return;
    event.preventDefault();
    strip.scrollLeft += event.deltaY;
}
