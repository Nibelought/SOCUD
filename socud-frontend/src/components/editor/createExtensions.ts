import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import LinkExtension from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { MathExtension } from '@aarkue/tiptap-math-extension';
import type { AnyExtension, Extensions } from '@tiptap/core';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import { common, createLowlight } from 'lowlight';
import { isSafeHref, SAFE_LINK_PROTOCOLS } from "@/lib/security";
import { CodeBlockUX } from './extensions/codeBlockUX';
import { PasteMarkdown } from './extensions/pasteMarkdown';
import { MarkdownShortcuts } from './extensions/markdownShortcuts';

const lowlight = createLowlight(common);

interface EditorExtensionsOptions {
    ydoc: Y.Doc;
    provider: HocuspocusProvider;
    userName: string;
    userColor: string;
    /** Extension that opens the LaTeX modal on a double click (see createMathDoubleClickExtension). */
    mathDoubleClickEdit: AnyExtension;
}

/** Tiptap extension set of the collaborative document editor. */
export function createEditorExtensions({ ydoc, provider, userName, userColor, mathDoubleClickEdit }: EditorExtensionsOptions): Extensions {
    return [
        StarterKit.configure({
            history: false,
            codeBlock: false,
            // `inputRules` is not in the typed options; spread keeps runtime config identical.
            heading: { ...({ inputRules: false } as object) },       // delegated to MarkdownShortcuts
            horizontalRule: { ...({ inputRules: false } as object) } // delegated to MarkdownShortcuts
        }),
        Markdown,
        MarkdownShortcuts,
        PasteMarkdown,
        MathExtension.configure({
            evaluation: false, // security: disable JS evaluation inside formulas
            // Enable auto-conversion when typing $...$ followed by a space
            ...({ addInputRules: true, addDisplayMath: true } as object), // not in typed options; kept as-is at runtime
        }),
        CodeBlockLowlight.configure({ lowlight }),
        CodeBlockUX,
        LinkExtension.configure({
            openOnClick: false,
            autolink: true,
            protocols: SAFE_LINK_PROTOCOLS,
            validate: isSafeHref,
            // Styled by .doc-content a (globals.css), the same in the editor and the reader.
            HTMLAttributes: { rel: 'noopener noreferrer' },
        }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({ provider, user: { name: userName, color: userColor } }),
        mathDoubleClickEdit,
    ];
}
