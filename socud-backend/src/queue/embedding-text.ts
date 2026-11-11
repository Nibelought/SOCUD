/**
 * Text preparation and vector post-processing for the hosted embedding API. A line-by-line port of
 * socud-ai-worker/embedder.py (`clean_content`, `format_query`, `prepare_text`, `mrl_truncate`):
 * the worker defines the vector space, so the API provider must feed the model exactly the same
 * strings. `embedding-text.spec.ts` checks it against fixtures produced by the real Python code
 * (socud-ai-worker/scripts/gen_prepare_text_fixtures.py); keep both in sync.
 *
 * Python and JavaScript regular expressions differ in what `\s`, `\S`, `\w`, `.`, `^` and `$` mean,
 * so none of those is used here as-is:
 *  - Python `\s` / `str.strip()` = Unicode whitespace incl. U+001C..U+001F and U+0085, but not
 *    U+FEFF (JS: the opposite on those three).
 *  - Python `\w` = Unicode letters, digits and `_` (JS: ASCII only).
 *  - Python `.` stops at `\n` only (JS also at U+2028/U+2029); Python MULTILINE `^`/`$` see `\n`
 *    only (JS also U+2028/U+2029; `\r` is already gone after normalisation).
 */

/** Python's whitespace set (str.isspace), spelled out for use inside a character class. */
const PY_WS =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
/** Python `\w` (Unicode letters, digits, underscore). */
const PY_WORD = '\\p{L}\\p{N}_';
/** Start of a line / end of a line in the Python MULTILINE sense. */
const BOL = '(?<![^\\n])';
const EOL = '(?![^\\n])';

const FENCE_LINE = new RegExp(`${BOL}[ \\t]*(?:\`{3,}|~{3,})[^\\n]*\\n?`, 'gu');
const IMAGE = /!\[[^\]]*\]\([^)]*\)/gu;
const LINK = /\[([^\]]+)\]\([^)]*\)/gu;
const HEADING = new RegExp(`${BOL}[ \\t]{0,3}#{1,6}[ \\t]+`, 'gu');
const QUOTE = new RegExp(`${BOL}[ \\t]*>+[ \\t]?`, 'gu');
const BULLET = new RegExp(`${BOL}[ \\t]*[-*+][ \\t]+`, 'gu');
const RULE = new RegExp(`${BOL}[ \\t]*(?:[-*_][ \\t]*){3,}${EOL}`, 'gu');
const BOLD = new RegExp(
  `(\\*\\*|__)(?=[^${PY_WS}])([\\s\\S]+?)(?<=[^${PY_WS}])\\1`,
  'gu',
);
const ITALIC_STAR = new RegExp(
  `(?<![${PY_WORD}*])\\*(?=[^${PY_WS}*])([^\\n]+?)(?<=[^${PY_WS}*])\\*(?![${PY_WORD}*])`,
  'gu',
);
const SPACES = /[ \t\u00a0]+/gu;
const BLANK_LINES = /\n{3,}/gu;
const PY_STRIP = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'gu');

const pyStrip = (text: string): string => text.replace(PY_STRIP, '');

/** Strip markdown markers that carry no meaning; keep words, code, formulas and intra-word hyphens. */
export function cleanContent(input: string): string {
  let text = input.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
  text = text.replace(FENCE_LINE, '');
  text = text.replace(IMAGE, '');
  text = text.replace(LINK, '$1');
  text = text.replace(RULE, '');
  text = text.replace(HEADING, '');
  text = text.replace(QUOTE, '');
  text = text.replace(BULLET, '');
  text = text.replace(BOLD, '$2');
  text = text.replace(ITALIC_STAR, '$1');
  text = text.replace(SPACES, ' ');
  text = text
    .split('\n')
    .map((line) => pyStrip(line))
    .join('\n');
  text = text.replace(BLANK_LINES, '\n\n');
  return pyStrip(text);
}

/** Official Qwen3-Embedding query format. Note: no space after 'Query:'. */
export function formatQuery(text: string, task: string): string {
  return `Instruct: ${task}\nQuery:${text}`;
}

/**
 * Clean a text and, for queries only, prepend the task instruction. Documents get no instruction.
 * `task` undefined (or empty) means "no instruction" for models that do not use one; the worker
 * always has one, so the Python original has no such case.
 */
export function prepareText(
  text: string,
  isQuery: boolean,
  task?: string,
): string {
  const cleaned = cleanContent(text);
  return isQuery && task ? formatQuery(cleaned, task) : cleaned;
}

export function l2Normalize(vector: number[]): number[] {
  let sum = 0;
  for (const x of vector) sum += x * x;
  const norm = Math.max(Math.sqrt(sum), 1e-12);
  return vector.map((x) => x / norm);
}

/** Matryoshka truncation: keep the first `dim` components, then L2-renormalise. */
export function mrlTruncate(vector: number[], dim: number): number[] {
  if (dim < 1 || dim > vector.length) {
    throw new RangeError(`dim must be in [1, ${vector.length}], got ${dim}`);
  }
  return l2Normalize(vector.slice(0, dim));
}
