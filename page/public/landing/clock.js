const TICK_MS = 1000;
const SHORT_TIME = new Intl.DateTimeFormat(navigator.language, {dateStyle: 'short', timeStyle: 'short'});

export function startClock(clock, onTextChange = () => {}) {
    const tick = () => {
        const now = new Date();
        const text = SHORT_TIME.format(now);
        clock.dateTime = now.toISOString();
        if (text === clock.textContent)
            return;
        clock.textContent = text;
        onTextChange();
    };
    tick();
    setInterval(tick, TICK_MS);
    return tick;
}
