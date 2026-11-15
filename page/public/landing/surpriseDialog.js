import {openPageDialog} from '../components/pageDialog.js';
import {reducedMotion} from './elements.js';
import {_} from '../shared/i18n.js';

const COUNTDOWN_FROM = 3;
const STEP_MS = 1000;
// Time to read the heading before the countdown starts
const READ_MS = 3000;
// Nothing from YouTube loads before the countdown ends
const VIDEO_URL = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1';

/**
 * Opens the Konami code surprise, a pause to read, a countdown and then the
 * video. The digits and the video share one fixed stage, so nothing reflows.
 */
export function openSurpriseDialog() {
    let timer = 0;
    const dialog = openPageDialog({
        title: _('Cheat Code'),
        className: 'surprise-dialog',
        onClose: () => clearTimeout(timer),
    });
    dialog.setBody(`<h2 class="surprise-heading">${_('Wow, you are creative')}</h2>` +
        `<p class="pref-description">${_('The cheat code gets you nothing here, but there is a surprise for you anyway.')}</p>` +
        '<div class="surprise-stage" aria-live="polite"></div>');
    const stage = dialog.host.querySelector('.surprise-stage');
    const showStep = count => {
        if (count === 0) {
            stage.innerHTML = `<iframe class="surprise-video" src="${VIDEO_URL}" title="${_('A surprise video')}" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
            return;
        }
        stage.innerHTML = `<span class="surprise-count ${reducedMotion.matches ? '' : 'animated'}">${count}</span>`;
        timer = setTimeout(() => showStep(count - 1), STEP_MS);
    };
    timer = setTimeout(() => showStep(COUNTDOWN_FROM), READ_MS);
}
