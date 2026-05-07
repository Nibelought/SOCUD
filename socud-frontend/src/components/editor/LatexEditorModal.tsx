"use client";

import { useState, useEffect, useRef } from 'react';
import katex from 'katex';
import { X, Check, Eye, Type, Maximize2 } from 'lucide-react';

interface LatexEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    editor: any;
    initialLatex?: string;
    isDisplay?: boolean;
    isEditing?: boolean;
    nodePos?: number;
}

export default function LatexEditorModal({ isOpen, onClose, editor, initialLatex = '', isDisplay = false, isEditing = false, nodePos }: LatexEditorModalProps) {
    const [latex, setLatex] = useState(initialLatex);
    const [previewHtml, setPreviewHtml] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [displayMode, setDisplayMode] = useState(isDisplay);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isOpen) {
            setLatex(initialLatex);
            setDisplayMode(isDisplay);
            setTimeout(() => textareaRef.current?.focus(), 100);
        }
    }, [isOpen, initialLatex, isDisplay]);

    useEffect(() => {
        if (!latex.trim()) {
            setPreviewHtml('');
            setError(null);
            return;
        }
        try {
            const html = katex.renderToString(latex, {
                displayMode: displayMode,
                throwOnError: true,
                trust: true,
                strict: false,
            });
            setPreviewHtml(html);
            setError(null);
        } catch (err: any) {
            setPreviewHtml('');
            setError(err.message || 'Invalid LaTeX syntax');
        }
    }, [latex, displayMode]);

    const handleApply = () => {
        if (!editor || !latex.trim() || error) return;

        const nodes = editor.schema.nodes;
        const inlineNode = nodes.inlineMath || nodes.mathInline || nodes.math;
        const blockNode = nodes.blockMath || nodes.displayMath || nodes.mathDisplay || nodes.math;
        const targetNode = displayMode ? (blockNode || inlineNode) : inlineNode;

        if (!targetNode) {
            editor.chain().focus().insertContent(displayMode ? `$$\n${latex}\n$$ ` : `$${latex}$ `).run();
            onClose();
            return;
        }

        const specAttrs = targetNode.spec.attrs || {};
        const attrName = 'latex' in specAttrs ? 'latex' : ('content' in specAttrs ? 'content' : 'text');
        const attrs: any = { [attrName]: latex };
        if (targetNode.name === 'math' && 'display' in specAttrs) attrs.display = displayMode;

        if (isEditing && nodePos !== undefined) {
            try {
                // Пытаемся обновить существующий узел по сохранённой позиции
                editor.chain().focus().setNodeSelection(nodePos).updateAttributes(targetNode.name, attrs).run();
            } catch {
                // Fallback: если позиция сместилась из-за Yjs-синхронизации, вставляем новый узел
                console.warn('[Math] Position shifted during collaboration. Inserting new node.');
                editor.chain().focus().insertContent({ type: targetNode.name, attrs }).run();
            }
        } else {
            editor.chain().focus().insertContent({ type: targetNode.name, attrs }).run();
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
            <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <Type className="w-4 h-4" /> LaTeX Editor
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setDisplayMode(false)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${!displayMode ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                            <Type className="w-3.5 h-3.5" /> Inline ($...$)
                        </button>
                        <button onClick={() => setDisplayMode(true)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${displayMode ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                            <Maximize2 className="w-3.5 h-3.5" /> Display ($$...$$)
                        </button>
                    </div>

                    <textarea
                        ref={textareaRef}
                        value={latex}
                        onChange={(e) => setLatex(e.target.value)}
                        placeholder="E = mc^2 \quad \text{or} \quad \int_0^\infty x^2 dx"
                        className="w-full h-32 px-4 py-3 border border-slate-300 rounded-lg font-mono text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none transition-all"
                        spellCheck={false}
                    />

                    <div className={`min-h-[80px] p-4 rounded-lg border flex items-center justify-center transition-colors ${error ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                        {error ? (
                            <div className="text-red-600 text-sm font-mono text-center whitespace-pre-wrap">{error}</div>
                        ) : latex.trim() ? (
                            <div className="flex items-center justify-center w-full overflow-x-auto">
                                <div dangerouslySetInnerHTML={{ __html: previewHtml }} className="text-slate-800" />
                            </div>
                        ) : (
                            <div className="text-slate-400 text-sm flex items-center gap-2"><Eye className="w-4 h-4" /> Live preview will appear here</div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 bg-slate-50">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
                    <button onClick={handleApply} disabled={!latex.trim() || !!error} className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
                        <Check className="w-4 h-4" /> {isEditing ? 'Update Formula' : 'Insert Formula'}
                    </button>
                </div>
            </div>
        </div>
    );
}