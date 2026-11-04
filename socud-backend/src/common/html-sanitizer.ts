import sanitizeHtml from 'sanitize-html';

type IOptions = sanitizeHtml.IOptions;
type AllowedAttribute = sanitizeHtml.AllowedAttribute;

/**
 * Server-side allowlist for published document HTML.
 *
 * It mirrors what the Tiptap editor (StarterKit + CodeBlockLowlight + Link +
 * @aarkue/tiptap-math-extension) serializes via `editor.getHTML()`. Everything
 * else (scripts, iframes, images, inline styles, event handlers, ...) is dropped.
 */
export const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'span',
  'div',
];

export const ALLOWED_URL_SCHEMES = ['http', 'https', 'mailto'];

/** Values the math extension writes into `data-type`. */
const MATH_TYPES = ['inlineMath', 'displayMath', 'blockMath'];

const MATH_ATTRIBUTES: AllowedAttribute[] = [
  { name: 'data-type', multiple: false, values: MATH_TYPES },
  'data-latex',
  {
    name: 'data-display',
    multiple: false,
    values: ['yes', 'no', 'true', 'false'],
  },
  { name: 'data-evaluate', multiple: false, values: ['yes', 'no'] },
  'class',
];

const CODE_CLASSES = ['language-*', 'hljs*'];

const OPTIONS: IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'class'],
    code: ['class'],
    pre: ['class'],
    span: MATH_ATTRIBUTES,
    div: MATH_ATTRIBUTES,
  },
  allowedClasses: {
    code: CODE_CLASSES,
    pre: CODE_CLASSES,
    // Classes the math extension / frontend math renderer look for.
    span: [
      'tiptap-math',
      'latex',
      'result',
      'katex',
      'math-inline',
      'math-display',
    ],
    div: [
      'tiptap-math',
      'latex',
      'result',
      'katex',
      'math-inline',
      'math-display',
    ],
    // Exact classes the editor's Link extension configures (Tailwind utilities).
    a: [
      'text-blue-600',
      'underline',
      'hover:text-blue-800',
      'transition-colors',
      'cursor-pointer',
    ],
  },
  allowedSchemes: ALLOWED_URL_SCHEMES,
  allowedSchemesAppliedToAttributes: ['href'],
  // Relative URLs ("/document/<uuid>", "#anchor") remain allowed; "//evil.example" is not.
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer' },
    }),
  },
};

export function sanitizeDocumentHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
