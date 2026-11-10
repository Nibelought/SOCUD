import { Extension } from '@tiptap/core';
import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import { MathExtension } from '@aarkue/tiptap-math-extension';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { sanitizeDocumentHtml } from '../common/html-sanitizer';
import { htmlToPlainText } from './html-text';

/** Name of the Y.XmlFragment the editor's Collaboration extension writes to (its default). */
export const YJS_FRAGMENT_NAME = 'default';

/**
 * The part of the editor's extension set that defines the document schema.
 *
 * It mirrors socud-frontend/src/components/editor/DocumentEditor.tsx. Extensions that only add
 * behaviour (history, Collaboration, CollaborationCursor, Markdown, input/paste rules, keyboard
 * shortcuts) have no influence on the schema or on `renderHTML` and are intentionally left out.
 * `CodeBlockLowlight` extends the plain `CodeBlock` without changing node spec or rendering, so
 * StarterKit's code block is used (it avoids pulling lowlight into the server).
 *
 * KEEP IN SYNC with the frontend when a node/mark is added there.
 */
export const SERVER_EXTENSIONS: Extension[] = [
  StarterKit.configure({ history: false }),
  MathExtension.configure({ evaluation: false }),
  LinkExtension.configure({
    openOnClick: false,
    HTMLAttributes: {
      class:
        'text-blue-600 underline hover:text-blue-800 transition-colors cursor-pointer',
    },
  }),
] as unknown as Extension[];

export interface RenderedDocument {
  /** Sanitized HTML (same allowlist as published content). */
  html: string;
  /** Plain text derived from the HTML. */
  text: string;
}

/**
 * Renders a persisted Yjs state (`Y.encodeStateAsUpdate`) into sanitized HTML and plain text.
 * Throws when the state cannot be decoded or does not match the schema; callers decide whether
 * that is fatal.
 */
export function renderYjsState(state: Uint8Array): RenderedDocument {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, state);
    const json = yXmlFragmentToProsemirrorJSON(
      ydoc.getXmlFragment(YJS_FRAGMENT_NAME),
    );
    const rawHtml = generateHTML(json, SERVER_EXTENSIONS);
    const html = sanitizeDocumentHtml(rawHtml);
    return { html, text: htmlToPlainText(html) };
  } finally {
    ydoc.destroy();
  }
}
