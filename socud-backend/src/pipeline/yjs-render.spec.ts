import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
import * as Y from 'yjs';
import {
  SERVER_EXTENSIONS,
  YJS_FRAGMENT_NAME,
  renderYjsState,
} from './yjs-render';

/** Builds a persisted Yjs state from ProseMirror JSON using the real editor schema. */
function stateFromJson(json: object): Uint8Array {
  const ydoc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(
    getSchema(SERVER_EXTENSIONS),
    json,
    ydoc.getXmlFragment(YJS_FRAGMENT_NAME),
  );
  return Y.encodeStateAsUpdate(ydoc);
}

const text = (t: string, marks?: object[]) => ({
  type: 'text',
  text: t,
  marks,
});

describe('renderYjsState', () => {
  it('renders headings, formatting, lists, code blocks and links', () => {
    const state = stateFromJson({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [text('Title')],
        },
        {
          type: 'paragraph',
          content: [
            text('Hello '),
            text('bold', [{ type: 'bold' }]),
            text(' and '),
            text('link', [
              {
                type: 'link',
                attrs: {
                  href: '/document/3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b',
                },
              },
            ]),
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [text('one')] }],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [text('const a = 1;')],
        },
      ],
    });

    const { html, text: plain } = renderYjsState(state);

    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain(
      'href="/document/3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b"',
    );
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<li><p>one</p></li>');
    expect(html).toContain(
      '<pre><code class="language-ts">const a = 1;</code></pre>',
    );
    expect(plain).toContain('Title');
    expect(plain).toContain('Hello bold and link');
    expect(plain).not.toContain('<');
    expect(plain).not.toContain('\u0001');
  });

  it('renders math nodes', () => {
    const state = stateFromJson({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }],
        },
      ],
    });
    expect(renderYjsState(state).html).toContain('x^2');
  });

  it('sanitizes the output even when the document carries a javascript: link', () => {
    const state = stateFromJson({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            text('x', [
              { type: 'link', attrs: { href: 'javascript:alert(1)' } },
            ]),
          ],
        },
      ],
    });
    expect(renderYjsState(state).html).not.toContain('javascript');
  });

  it('renders an empty document', () => {
    const { html, text: plain } = renderYjsState(
      Y.encodeStateAsUpdate(new Y.Doc()),
    );
    expect(html).toBe('');
    expect(plain).toBe('');
  });

  it('throws on a corrupt state', () => {
    expect(() => renderYjsState(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
