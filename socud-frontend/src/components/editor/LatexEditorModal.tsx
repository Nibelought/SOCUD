"use client";

import { useEffect, useState } from 'react';
import katex from 'katex';
import type { Editor } from '@tiptap/react';
import { KATEX_OPTIONS } from '@/lib/security';
import { caughtMessage } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/Bits';
import { Sheet } from '@/components/ui/Sheet';
import { mathAttrKey } from './extensions/mathNodes';

interface LatexEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    editor: Editor | null;
    initialLatex?: string;
    isDisplay?: boolean;
    isEditing?: boolean;
    nodePos?: number;
}

/** Formula sheet: LaTeX source with a live preview; inserts or updates a math node. */
export default function LatexEditorModal({ isOpen, onClose, editor, initialLatex = '', isDisplay = false, isEditing = false, nodePos }: LatexEditorModalProps) {
    return (
        <Sheet
            open={isOpen}
            onClose={onClose}
            title={isEditing ? 'Edit Formula' : 'Insert Formula'}
            description="Write LaTeX. The preview updates as you type."
            size="md"
        >
            {isOpen && (
                <FormulaForm
                    editor={editor}
                    onClose={onClose}
                    initialLatex={initialLatex}
                    isDisplay={isDisplay}
                    isEditing={isEditing}
                    nodePos={nodePos}
                />
            )}
        </Sheet>
    );
}

function FormulaForm({ editor, onClose, initialLatex, isDisplay, isEditing, nodePos }: Omit<LatexEditorModalProps, 'isOpen'>) {
    const [latex, setLatex] = useState(initialLatex ?? '');
    const [displayMode, setDisplayMode] = useState(!!isDisplay);
    const [previewHtml, setPreviewHtml] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!latex.trim()) {
            setPreviewHtml('');
            setError(null);
            return;
        }
        try {
            setPreviewHtml(katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode, throwOnError: true }));
            setError(null);
        } catch (err) {
            setPreviewHtml('');
            setError(caughtMessage(err, 'This LaTeX has a syntax error'));
        }
    }, [latex, displayMode]);

    const apply = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!editor || !latex.trim() || error) return;

        const nodes = editor.schema.nodes;
        const inlineNode = nodes.inlineMath || nodes.mathInline || nodes.math;
        const blockNode = nodes.blockMath || nodes.displayMath || nodes.mathDisplay || nodes.math;
        const targetNode = displayMode ? blockNode || inlineNode : inlineNode;

        if (!targetNode) {
            editor.chain().focus().insertContent(displayMode ? `$$\n${latex}\n$$ ` : `$${latex}$ `).run();
            onClose?.();
            return;
        }

        const specAttrs = targetNode.spec.attrs || {};
        const attrs: Record<string, unknown> = { [mathAttrKey(targetNode)]: latex };
        if (targetNode.name === 'math' && 'display' in specAttrs) attrs.display = displayMode;

        if (isEditing && nodePos !== undefined) {
            try {
                editor.chain().focus().setNodeSelection(nodePos).updateAttributes(targetNode.name, attrs).run();
            } catch {
                // The position moved while collaborating: insert a new node instead.
                editor.chain().focus().insertContent({ type: targetNode.name, attrs }).run();
            }
        } else {
            editor.chain().focus().insertContent({ type: targetNode.name, attrs }).run();
        }
        onClose?.();
    };

    return (
        <form onSubmit={apply} className="flex flex-col gap-4">
            <SegmentedControl
                label="Formula layout"
                value={displayMode ? 'display' : 'inline'}
                onChange={(v) => setDisplayMode(v === 'display')}
                options={[
                    { value: 'inline', label: 'In Text' },
                    { value: 'display', label: 'On Its Own Line' },
                ]}
                className="self-start"
            />
            <label className="flex flex-col gap-1.5">
                <span className="text-footnote font-medium">LaTeX</span>
                <textarea
                    autoFocus
                    value={latex}
                    onChange={(e) => setLatex(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) apply();
                    }}
                    placeholder={'E = mc^2 \\quad \\text{or} \\quad \\int_0^\\infty x^2\\,dx'}
                    rows={4}
                    spellCheck={false}
                    aria-invalid={!!error || undefined}
                    className="w-full resize-none rounded-field bg-window px-3 py-2 font-mono text-footnote text-label shadow-[inset_0_0_0_1px_var(--c-separator-strong)] outline-none focus:shadow-[inset_0_0_0_1px_var(--c-accent),0_0_0_3px_color-mix(in_srgb,var(--c-accent)_25%,transparent)]"
                />
            </label>
            <div
                aria-live="polite"
                className={cn(
                    'flex min-h-[96px] items-center justify-center overflow-x-auto rounded-tile px-4 py-3',
                    error ? 'bg-warning-fill' : 'bg-grouped',
                )}
            >
                {error ? (
                    <p className="whitespace-pre-wrap text-center font-mono text-footnote text-danger">{error}</p>
                ) : previewHtml ? (
                    <div className="doc-content" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                    <p className="text-footnote text-label-2">The preview appears here.</p>
                )}
            </div>
            <div className="-mx-6 -mb-5 flex items-center justify-between gap-2 border-t border-separator px-6 py-3.5">
                <span className="hidden text-footnote text-label-2 sm:block">⌘↩ to {isEditing ? 'update' : 'insert'}</span>
                <div className="ml-auto flex gap-2">
                    <Button onClick={onClose}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={!latex.trim() || !!error}>
                        {isEditing ? 'Update Formula' : 'Insert Formula'}
                    </Button>
                </div>
            </div>
        </form>
    );
}
