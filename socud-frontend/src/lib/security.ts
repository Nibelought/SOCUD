import createDOMPurify from 'dompurify';
import type { KatexOptions } from 'katex';

/**
 * Client-side XSS defences. These are defence in depth: the backend sanitizes
 * on publish, but documents published before that change are stored unsanitized,
 * so everything rendered from stored HTML must be sanitized here independently.
 */

// --- URLs ---------------------------------------------------------------

const PLACEHOLDER_BASE = 'http://placeholder.invalid';
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

// Characters browsers ignore or strip inside/around URLs: C0/C1 controls, space,
// soft hyphen, zero-width and BOM characters, and Unicode line/paragraph separators.
function isIgnoredUrlChar(code: number): boolean {
  return (
    code <= 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0xad ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x2060 ||
    code === 0xfeff
  );
}

function stripIgnoredUrlChars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (!isIgnoredUrlChar(value.charCodeAt(i))) out += value[i];
  }
  return out;
}

/**
 * True only for http:, https:, mailto:, relative paths (`/x`, `./x`, `../x`,
 * `x/y`, `?q`) and `#fragment` links. Everything else (javascript:, data:,
 * vbscript:, protocol-relative `//host`, unknown schemes, and obfuscated
 * variants of those) is rejected.
 */
export function isSafeHref(href: string): boolean {
  if (typeof href !== 'string') return false;

  // Browsers drop tabs/newlines anywhere in a URL and trim leading control
  // characters/spaces, so `java\tscript:` is `javascript:`. Normalise the same way.
  const cleaned = stripIgnoredUrlChars(href);
  if (cleaned === '') return false;

  if (cleaned.startsWith('#')) return true;

  // Protocol-relative (`//evil.com`) and backslash variants (`/\evil.com`,
  // `\\evil.com`) which browsers treat as `//`.
  if (/^[/\\]{2}/.test(cleaned) || cleaned.startsWith('\\')) return false;

  // The segment before the first `/` or `?` is where a scheme would live (`#` is
  // not a delimiter here because it also begins numeric entities like `&#106;`).
  // Reject encoded colons / entity-encoded characters there: the browser never
  // decodes them for a scheme, but downstream code (or a double-decode) might.
  const head = cleaned.split(/[/?]/, 1)[0];
  if (/%3a/i.test(head) || /&(#x?[0-9a-f]+|colon|tab|newline|[a-z]+);/i.test(head)) return false;

  let url: URL;
  try {
    url = new URL(cleaned, PLACEHOLDER_BASE);
  } catch {
    return false;
  }
  return SAFE_PROTOCOLS.has(url.protocol);
}

/** Protocols for the Tiptap Link extension (mirrors `isSafeHref`). */
export const SAFE_LINK_PROTOCOLS = ['http', 'https', 'mailto'];

// --- KaTeX --------------------------------------------------------------

/**
 * Shared KaTeX options. `trust: false` disables \href, \url, \includegraphics,
 * \htmlClass and friends, which would otherwise allow `javascript:` links and
 * attribute injection from LaTeX source.
 */
export const KATEX_OPTIONS: KatexOptions = {
  throwOnError: false,
  trust: false,
  strict: false,
  maxSize: 20, // em; caps \rule / \kern based layout abuse
  maxExpand: 1000, // macro expansions; caps exponential-macro DoS
};

// --- HTML sanitizing ----------------------------------------------------

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3',
  'strong', 'em', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'span', 'div',
];

// Attribute names are further restricted per tag in the hook below.
const ALLOWED_ATTR = [
  'href', 'title', 'rel',
  'data-type', 'data-latex', 'data-display', 'latex', 'display',
  'class',
];

const FORBID_TAGS = [
  'style', 'script', 'iframe', 'object', 'embed', 'form', 'img', 'svg', 'math',
  'link', 'meta', 'base', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'source',
];

const FORBID_ATTR = ['style', 'srcdoc', 'src', 'srcset', 'formaction', 'action', 'xlink:href'];

const MATH_ATTRS = new Set(['data-type', 'data-latex', 'data-display', 'latex', 'display']);
const CODE_CLASS_RE = /^(language-[\w+#.-]+|hljs[\w-]*)$/;

type Purifier = ReturnType<typeof createDOMPurify>;
let purifier: Purifier | null = null;

function getPurifier(): Purifier | null {
  if (typeof window === 'undefined') return null;
  if (purifier) return purifier;

  const instance = createDOMPurify(window);
  if (!instance.isSupported) return null;

  instance.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName.toLowerCase();
    const name = data.attrName;

    if (name === 'href' || name === 'title' || name === 'rel') {
      if (tag !== 'a') { data.keepAttr = false; return; }
      if (name === 'href' && !isSafeHref(data.attrValue)) data.keepAttr = false;
      return;
    }
    if (MATH_ATTRS.has(name)) {
      if (tag !== 'span' && tag !== 'div') data.keepAttr = false;
      return;
    }
    if (name === 'class') {
      if (tag === 'span' || tag === 'div') return;
      if (tag === 'code' || tag === 'pre') {
        const kept = data.attrValue.split(/\s+/).filter((c) => CODE_CLASS_RE.test(c));
        if (kept.length === 0) { data.keepAttr = false; return; }
        data.attrValue = kept.join(' ');
        return;
      }
      data.keepAttr = false;
    }
  });

  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName.toLowerCase() === 'a') {
      if (node.hasAttribute('href')) node.setAttribute('rel', 'noopener noreferrer');
      else node.removeAttribute('rel');
    }
  });

  purifier = instance;
  return instance;
}

/**
 * Sanitizes stored document HTML for rendering. Allowlist mirrors the backend
 * publish-time sanitizer. Returns '' when no DOM is available (SSR), so it
 * fails closed rather than passing HTML through.
 */
export function sanitizeDocumentHtml(html: string): string {
  if (!html) return '';
  const instance = getPurifier();
  if (!instance) return '';
  return instance.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS,
    FORBID_ATTR,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}
