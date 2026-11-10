import { HEADLINE_START, HEADLINE_STOP } from './search.constants';
import type { SearchHighlight } from './search.types';

/* eslint-disable no-control-regex */
// Control characters (incl. the chunker's heading mark) are never text.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// Same, but keeps the headline markers (HEADLINE_START = \u0002, HEADLINE_STOP = \u0003).
const CONTROL_CHARS_KEEP_MARKERS =
  /[\u0000\u0001\u0004-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/* eslint-enable no-control-regex */

export const SNIPPET_MAX_CHARS = 240;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

/**
 * Plain-text snippet: control characters removed, whitespace collapsed, cut to `max` characters
 * at a word boundary. The result is TEXT, not HTML: it is deliberately not HTML-escaped (the
 * client renders it as a text node, escaping here would show `&lt;`), and this code never adds
 * markup to it.
 */
export function plainSnippet(
  text: string | null | undefined,
  max = SNIPPET_MAX_CHARS,
): string {
  const clean = (text ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(clean, max);
}

/**
 * Turns ts_headline output (matches wrapped in HEADLINE_START/STOP) into plain text plus the
 * matched ranges. Whitespace is collapsed and the text clipped like `plainSnippet`; the ranges
 * refer to the final text.
 */
export function parseHeadline(
  headline: string,
  max = SNIPPET_MAX_CHARS,
): { text: string; highlights: SearchHighlight[] } {
  let text = '';
  let pendingSpace = false;
  let open: number | null = null;
  const highlights: SearchHighlight[] = [];

  const emitSpace = () => {
    if (pendingSpace && text.length > 0) text += ' ';
    pendingSpace = false;
  };

  for (const ch of headline.replace(CONTROL_CHARS_KEEP_MARKERS, ' ')) {
    if (ch === HEADLINE_START) {
      emitSpace();
      open = text.length;
    } else if (ch === HEADLINE_STOP) {
      if (open !== null && text.length > open) {
        highlights.push({ start: open, end: text.length });
      }
      open = null;
    } else if (/\s/.test(ch)) {
      pendingSpace = true;
    } else {
      emitSpace();
      text += ch;
    }
  }

  const clipped = clip(text, max);
  const limit =
    clipped.endsWith('...') && clipped !== text
      ? clipped.length - 3
      : clipped.length;
  return {
    text: clipped,
    highlights: highlights
      .filter((h) => h.start < limit)
      .map((h) => ({ start: h.start, end: Math.min(h.end, limit) })),
  };
}
