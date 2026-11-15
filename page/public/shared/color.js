import {clamp} from './util.js';

export const CHANNEL_MAX = 255;
const HEX_COLOR = /^#([\da-f]{6}|[\da-f]{8})$/i;
const RGB_COLOR = /^rgba?\(([^)]+)\)$/i;

export function parseColor(value) {
    const hex = value.match(HEX_COLOR)?.[1];
    if (hex) {
        const [red, green, blue, alpha = CHANNEL_MAX] = hex.match(/../g).map(pair => parseInt(pair, 16));
        return {red: red / CHANNEL_MAX, green: green / CHANNEL_MAX, blue: blue / CHANNEL_MAX, alpha: alpha / CHANNEL_MAX};
    }
    const channels = value.match(RGB_COLOR)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (!channels || channels.length < 3 || channels.some(Number.isNaN))
        return null;
    const [red, green, blue, alpha = 1] = channels;
    return {red: red / CHANNEL_MAX, green: green / CHANNEL_MAX, blue: blue / CHANNEL_MAX, alpha: clamp(alpha, 0, 1)};
}
