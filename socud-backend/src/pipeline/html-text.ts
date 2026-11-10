import { compile } from 'html-to-text';

/** Marks the start of a heading block in the intermediate text; stripped before leaving this module. */
export const HEADING_MARK = '\u0001';

const converter = compile({
  wordwrap: false,
  formatters: {
    // Like the built-in block formatter, but prefixes the text with HEADING_MARK so the chunker
    // can start a new chunk at a heading (html-to-text's own heading output loses that info).
    socudHeading: (elem, walk, builder) => {
      builder.openBlock({ leadingLineBreaks: 2 });
      builder.addInline(HEADING_MARK, { noWordTransform: true });
      walk(elem.children, builder);
      builder.closeBlock({ trailingLineBreaks: 2 });
    },
  },
  selectors: [
    ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
      selector,
      format: 'socudHeading',
    })),
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'hr', format: 'skip' },
  ],
});

/** Text with HEADING_MARK in front of every heading block (input of the chunker). */
export function htmlToMarkedText(html: string): string {
  return converter(html).replace(/\r\n?/g, '\n');
}

/** Plain text of sanitized HTML, without markers. */
export function htmlToPlainText(html: string): string {
  return htmlToMarkedText(html).split(HEADING_MARK).join('').trim();
}
