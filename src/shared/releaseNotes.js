import {parseMarkdown} from './markdownParse.js';

// The viewers print the release name above the body, so Release Please's own
// version heading, with or without compare link and date, only repeats it
const VERSION_HEADING = /^\[?v?\d+\.\d+\.\d+[\w.+-]*(?:\]\([^)\s]*\))?(?:\s+\(\d{4}-\d{2}-\d{2}\))?$/;
const DEEPEST_HEADING_LEVEL = 6;

// Sections like Features go one level down so they read as list captions
// under the release name, not as titles of their own
export function parseReleaseNotes(body) {
    const blocks = parseMarkdown(body);
    const first = blocks[0];
    const hasVersionHeading = first?.type === 'heading' && VERSION_HEADING.test(first.text.trim());
    return blocks.slice(hasVersionHeading ? 1 : 0).map(block => block.type === 'heading'
        ? {...block, level: Math.min(block.level + 1, DEEPEST_HEADING_LEVEL)}
        : block);
}
