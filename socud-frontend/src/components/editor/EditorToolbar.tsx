"use client";
"use no memo"; // Reads the mutable Tiptap Editor during render (isActive, selection); compiler memoization would freeze the toolbar state

import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
    Bold, ChevronDown, Code, Italic, Link as LinkIcon, List, ListOrdered, Sigma, Strikethrough, Type,
} from 'lucide-react';
import { isSafeHref } from "@/lib/security";
import { cn } from '@/lib/cn';
import { Button, IconButton } from '@/components/ui/Button';
import { Menu, Popover } from '@/components/ui/Menu';
import { LATEX_SNIPPETS } from './latexSnippets';
import { mathAttrKey } from './extensions/mathNodes';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/**
 * Formatting bar: a floating capsule over the document (functional layer), grouped by function:
 * paragraph style, character style, lists, insert. Every control has a tooltip with its shortcut.
 */
export default function EditorToolbar({ editor, openLatexEditor }: { editor: Editor | null; openLatexEditor: (latex?: string, display?: boolean) => void }) {
    if (!editor) return null;

    const chain = () => editor.chain().focus();
    const styles = [
        { label: 'Body', active: editor.isActive('paragraph'), run: () => chain().setParagraph().run() },
        { label: 'Heading 1', active: editor.isActive('heading', { level: 1 }), run: () => chain().toggleHeading({ level: 1 }).run() },
        { label: 'Heading 2', active: editor.isActive('heading', { level: 2 }), run: () => chain().toggleHeading({ level: 2 }).run() },
        { label: 'Heading 3', active: editor.isActive('heading', { level: 3 }), run: () => chain().toggleHeading({ level: 3 }).run() },
        { label: 'Quote', active: editor.isActive('blockquote'), run: () => chain().toggleBlockquote().run() },
        { label: 'Code Block', active: editor.isActive('codeBlock'), run: () => toggleCodeBlock(editor) },
    ];
    const currentStyle = [...styles].reverse().find((s) => s.active)?.label ?? 'Body';

    return (
        <div
            role="toolbar"
            aria-label="Formatting"
            className="material-floating flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full px-1.5 py-1"
        >
            <Menu
                label="Paragraph style"
                items={styles.map((s) => ({ label: s.label, checked: s.active && s.label === currentStyle, onSelect: s.run }))}
                trigger={(props) => (
                    <button
                        {...props}
                        type="button"
                        title="Paragraph style"
                        className="inline-flex h-7 w-[118px] items-center gap-1.5 rounded-full px-2.5 text-footnote font-medium text-label hover:bg-hover"
                    >
                        <Type className="size-4 text-label-2" strokeWidth={1.8} aria-hidden />
                        <span className="flex-1 truncate text-left">{currentStyle}</span>
                        <ChevronDown className="size-3 text-label-2" aria-hidden />
                    </button>
                )}
            />
            <Divider />
            <Tool editor={editor} icon={Bold} label="Bold" shortcut={`${mod}B`} active={editor.isActive('bold')} run={() => chain().toggleBold().run()} />
            <Tool editor={editor} icon={Italic} label="Italic" shortcut={`${mod}I`} active={editor.isActive('italic')} run={() => chain().toggleItalic().run()} />
            <Tool editor={editor} icon={Strikethrough} label="Strikethrough" shortcut={`${mod}⇧S`} active={editor.isActive('strike')} run={() => chain().toggleStrike().run()} />
            <Tool editor={editor} icon={Code} label="Code" shortcut={`${mod}E`} active={editor.isActive('code')} run={() => chain().toggleCode().run()} />
            <Divider />
            <Tool editor={editor} icon={List} label="Bulleted List" shortcut={`${mod}⇧8`} active={editor.isActive('bulletList')} run={() => chain().toggleBulletList().run()} />
            <Tool editor={editor} icon={ListOrdered} label="Numbered List" shortcut={`${mod}⇧7`} active={editor.isActive('orderedList')} run={() => chain().toggleOrderedList().run()} />
            <Divider />
            <LinkTool editor={editor} />
            <IconButton icon={Sigma} size="sm" label="Insert Formula" onClick={() => openLatexEditor()} />
            <QuickMath editor={editor} />
        </div>
    );
}

function Divider() {
    return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-separator-strong" />;
}

function Tool({ icon, label, shortcut, active, run }: { editor: Editor; icon: typeof Bold; label: string; shortcut?: string; active: boolean; run: () => void }) {
    return <IconButton icon={icon} size="sm" label={label} shortcut={shortcut} active={active} aria-pressed={active} onClick={run} className="rounded-full" />;
}

function toggleCodeBlock(editor: Editor) {
    if (editor.isActive('codeBlock')) {
        editor.chain().focus().toggleCodeBlock().run();
        return;
    }
    const { from, to, empty } = editor.state.selection;
    if (empty) {
        editor.chain().focus().toggleCodeBlock().run();
        return;
    }
    const text = editor.state.doc.textBetween(from, to, '\n');
    editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent({ type: 'codeBlock', content: text ? [{ type: 'text', text }] : undefined })
        .run();
}

/** Link popover: replaces window.prompt with an inline field that validates the address. */
function LinkTool({ editor }: { editor: Editor }) {
    const [url, setUrl] = useState('');
    const [error, setError] = useState<string | null>(null);
    const hasLink = editor.isActive('link');

    return (
        <Popover
            label="Link"
            className="w-[300px] p-3"
            onOpen={() => {
                setUrl((editor.getAttributes('link').href as string | undefined) ?? '');
                setError(null);
            }}
            trigger={(props) => (
                <IconButton {...props} icon={LinkIcon} size="sm" label={hasLink ? 'Edit Link' : 'Add Link'} active={hasLink} className="rounded-full" />
            )}
        >
            {(close) => (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        const value = url.trim();
                        if (!value) {
                            editor.chain().focus().extendMarkRange('link').unsetLink().run();
                            close();
                            return;
                        }
                        if (!isSafeHref(value)) {
                            setError('Use a web address (https://…), an email link (mailto:…) or a path in SOCUD (/document/…).');
                            return;
                        }
                        editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
                        close();
                    }}
                    className="flex flex-col gap-2"
                >
                    <label htmlFor="link-url" className="text-footnote font-medium">
                        Link address
                    </label>
                    <input
                        id="link-url"
                        autoFocus
                        value={url}
                        onChange={(e) => {
                            setUrl(e.target.value);
                            setError(null);
                        }}
                        placeholder="https://example.com or /document/…"
                        aria-invalid={!!error || undefined}
                        aria-describedby={error ? 'link-error' : undefined}
                        className="h-8 rounded-field bg-window px-2.5 text-body text-label shadow-[inset_0_0_0_1px_var(--c-separator-strong)] outline-none focus:shadow-[inset_0_0_0_1px_var(--c-accent)]"
                    />
                    {error && (
                        <p id="link-error" className="text-footnote text-danger">
                            {error}
                        </p>
                    )}
                    <div className="mt-1 flex justify-end gap-2">
                        {hasLink && (
                            <Button
                                size="sm"
                                variant="destructive-plain"
                                onClick={() => {
                                    editor.chain().focus().extendMarkRange('link').unsetLink().run();
                                    close();
                                }}
                            >
                                Remove Link
                            </Button>
                        )}
                        <Button size="sm" variant="primary" type="submit">
                            {hasLink ? 'Update' : 'Add Link'}
                        </Button>
                    </div>
                </form>
            )}
        </Popover>
    );
}

const sanitizeLatex = (latex: string) =>
    latex
        .replace(/\\begin\{equation\*?\}/g, '')
        .replace(/\\end\{equation\*?\}/g, '')
        .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
        .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
        .trim();

/** Inserts math even when only inlineMath is registered (display falls back to the $$ input rule). */
function insertMath(editor: Editor, latex: string, isDisplay: boolean) {
    if (!latex.trim()) return;
    const cleanLatex = sanitizeLatex(latex);
    const { nodes } = editor.schema;
    const inlineNode = nodes.inlineMath || nodes.mathInline || nodes.math;
    const blockNode = nodes.blockMath || nodes.displayMath || nodes.mathDisplay;
    const targetNode = isDisplay ? blockNode || inlineNode : inlineNode;
    if (!targetNode) return;

    if (isDisplay && blockNode) {
        editor.chain().focus().insertContent({ type: blockNode.name, attrs: { [mathAttrKey(blockNode)]: cleanLatex, display: true } }).run();
    } else if (isDisplay) {
        editor.chain().focus().insertContent(`$$\n${cleanLatex}\n$$\n`).run();
    } else {
        editor.chain().focus().insertContent({ type: targetNode.name, attrs: { [mathAttrKey(targetNode)]: cleanLatex } }).run();
    }
}

const CATEGORY_LABELS: Record<string, string> = { Greek: 'Greek letters', Operators: 'Operators', Structures: 'Structures', Functions: 'Functions' };

/** Palette of common symbols and structures, inserted as inline math. */
function QuickMath({ editor }: { editor: Editor }) {
    return (
        <Popover
            label="Symbols"
            align="end"
            className="scrollbar-thin max-h-[min(420px,60vh)] w-[300px] overflow-y-auto p-3"
            trigger={(props) => (
                <button
                    {...props}
                    type="button"
                    aria-label="Symbols and structures"
                    title="Symbols and structures"
                    className="-ml-1 inline-flex h-7 w-4 items-center justify-center rounded-full text-label-2 hover:bg-hover hover:text-label"
                >
                    <ChevronDown className="size-3" aria-hidden />
                </button>
            )}
        >
            {(close) => (
                <div className="flex flex-col gap-3">
                    {Object.entries(LATEX_SNIPPETS).map(([category, items]) => (
                        <div key={category}>
                            <p className="mb-1.5 text-caption font-semibold text-label-2">{CATEGORY_LABELS[category] ?? category}</p>
                            <div className="grid grid-cols-4 gap-1">
                                {items.map((item) => (
                                    <button
                                        key={item.latex}
                                        type="button"
                                        title={item.latex}
                                        onClick={() => {
                                            insertMath(editor, item.latex, false);
                                            close();
                                        }}
                                        className={cn(
                                            'h-8 truncate rounded-control bg-fill px-1.5 text-body text-label hover:bg-fill-strong',
                                            item.label.length > 3 && 'col-span-2 text-footnote',
                                        )}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Popover>
    );
}
