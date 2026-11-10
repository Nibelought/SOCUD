import { HEADING_MARK, htmlToMarkedText } from './html-text';

/**
 * Chunking for Qwen3 embeddings: ~1,800 characters of body (roughly 450 tokens) plus up to ~200
 * characters of overlap with the previous chunk, so no chunk exceeds MAX_CHUNK_CHARS. That stays
 * far below the AI worker's character cap (MAX_TEXT_LENGTH).
 */
export const TARGET_CHUNK_CHARS = 1800;
export const OVERLAP_CHARS = 200;
export const MAX_CHUNK_CHARS = TARGET_CHUNK_CHARS + OVERLAP_CHARS;

interface Block {
  text: string;
  heading: boolean;
}

/** Splits one over-long block into pieces of at most `max` chars (sentences, then words, then hard cut). */
function splitLongBlock(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const pieces: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) pieces.push(current.trim());
    current = '';
  };
  // Sentence boundaries first, then whitespace, so words are not cut in the middle.
  const units = text
    .split(/(?<=[.!?…。！？])\s+|\n/)
    .flatMap((s) => (s.length > max ? s.split(/(?<=\s)/) : [s]));
  for (const unit of units) {
    if (unit.length > max) {
      // A single token longer than max (e.g. a minified blob): hard cut.
      flush();
      for (let i = 0; i < unit.length; i += max) {
        pieces.push(unit.slice(i, i + max));
      }
      continue;
    }
    if (current.length + unit.length + 1 > max) flush();
    current += (current ? ' ' : '') + unit.trim();
  }
  flush();
  return pieces;
}

/** Last ≤ `size` chars of `text`, starting at a word boundary. */
function tail(text: string, size: number): string {
  if (text.length <= size) return text;
  const cut = text.slice(text.length - size);
  const space = cut.search(/\s/);
  return (space === -1 ? cut : cut.slice(space + 1)).trim();
}

/**
 * Splits marked text (see htmlToMarkedText) into chunks on paragraph/heading boundaries.
 * A heading always starts a new chunk (and gets no overlap from the previous section).
 */
export function chunkMarkedText(
  marked: string,
  options: { target?: number; overlap?: number } = {},
): string[] {
  const target = options.target ?? TARGET_CHUNK_CHARS;
  const overlap = Math.min(options.overlap ?? OVERLAP_CHARS, target);

  const blocks: Block[] = [];
  for (const raw of marked.split(/\n{2,}/)) {
    const heading = raw.startsWith(HEADING_MARK);
    const text = raw.split(HEADING_MARK).join('').trim();
    if (!text) continue;
    for (const piece of splitLongBlock(text, target)) {
      blocks.push({ text: piece, heading });
    }
  }

  const bodies: { text: string; startsWithHeading: boolean }[] = [];
  let parts: string[] = [];
  let length = 0;
  let startsWithHeading = false;
  const flush = () => {
    if (parts.length > 0) {
      bodies.push({ text: parts.join('\n\n'), startsWithHeading });
    }
    parts = [];
    length = 0;
  };

  for (const block of blocks) {
    const extra = block.text.length + (parts.length > 0 ? 2 : 0);
    // Flush before a heading, or when the block does not fit anymore.
    if (parts.length > 0 && (block.heading || length + extra > target)) flush();
    if (parts.length === 0) startsWithHeading = block.heading;
    length += block.text.length + (parts.length > 0 ? 2 : 0);
    parts.push(block.text);
  }
  flush();

  return bodies
    .map((body, i) => {
      if (i === 0 || body.startsWithHeading || overlap === 0) return body.text;
      // The 2-char separator counts against the overlap budget, keeping chunks <= target + overlap.
      const prefix = tail(bodies[i - 1].text, Math.max(0, overlap - 2));
      return prefix ? `${prefix}\n\n${body.text}` : body.text;
    })
    .filter((chunk) => /[\p{L}\p{N}]/u.test(chunk));
}

/** Chunks of sanitized document HTML, ready to be embedded. */
export function chunkHtml(html: string): string[] {
  return chunkMarkedText(htmlToMarkedText(html));
}
