"use client";
"use no memo"; // Reads the mutable Tiptap Editor during render (isActive, selection); compiler memoization would freeze the toolbar state

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
    Bold, Italic, Strikethrough, Code, Sigma,
    Heading1, Heading2, List, ListOrdered, Quote,
    Terminal, Link as LinkIcon, ChevronDown, X
} from 'lucide-react';
import { isSafeHref } from "@/lib/security";
import { LATEX_SNIPPETS } from './latexSnippets';
import { mathAttrKey } from './extensions/mathNodes';

export default function EditorToolbar({ editor, openLatexEditor }: { editor: Editor | null; openLatexEditor: (latex?: string, display?: boolean) => void }) {
    const [showLatexPanel, setShowLatexPanel] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setShowLatexPanel(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!editor) return null;

    const toggleBtnClass = (isActive: boolean) =>
        `p-1.5 rounded-md transition-colors ${isActive ? 'bg-slate-200 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`;

    const sanitizeLatex = (latex: string) => {
        return latex
            .replace(/\\begin\{equation\*?\}/g, '')
            .replace(/\\end\{equation\*?\}/g, '')
            .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
            .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
            .trim();
    };

    // ✅ ОТКАЗОУСТОЙЧИВАЯ ВСТАВКА (работает даже если зарегистрирован только inlineMath)
    const insertMath = (latex: string, isDisplay: boolean) => {
        if (!editor || !latex.trim()) return;

        // 1. Очищаем LaTeX от конфликтных окружений
        const cleanLatex = sanitizeLatex(latex);
        const { nodes } = editor.schema;

        // 2. Ищем узлы
        const inlineNode = nodes.inlineMath || nodes.mathInline || nodes.math;
        const blockNode  = nodes.blockMath || nodes.displayMath || nodes.mathDisplay;
        const targetNode = isDisplay ? (blockNode || inlineNode) : inlineNode;

        if (!targetNode) {
            console.warn('[Math] No math nodes registered.');
            return;
        }

        // 3. Если блочный узел есть → вставляем напрямую с флагом display
        if (isDisplay && blockNode) {
            const attrKey = mathAttrKey(blockNode);
            editor.chain().focus().insertContent({
                type: blockNode.name,
                attrs: { [attrKey]: cleanLatex, display: true }
            }).run();
            setShowLatexPanel(false);
            return;
        }

        // 4. Fallback для Display, если в схеме только inlineMath:
        // Вставляем $$\n...\n$$ + пробел. Это гарантированно триггерит
        // встроенное input-правило расширения, которое само создаст
        // корректный display-узел с displayMode: true.
        if (isDisplay) {
            editor.chain().focus().insertContent(`$$\n${cleanLatex}\n$$\n`).run();
        } else {
            // Inline вставка
            const attrKey = mathAttrKey(targetNode);
            editor.chain().focus().insertContent({
                type: targetNode.name,
                attrs: { [attrKey]: cleanLatex }
            }).run();
        }
        setShowLatexPanel(false);
    };

    const handleCodeBlock = () => {
        if (editor.isActive('codeBlock')) { editor.chain().focus().toggleCodeBlock().run(); return; }
        const { from, to, empty } = editor.state.selection;
        if (empty) { editor.chain().focus().toggleCodeBlock().run(); return; }
        const text = editor.state.doc.textBetween(from, to, '\n');
        editor.chain().focus().deleteRange({ from, to }).insertContent({ type: 'codeBlock', content: text ? [{ type: 'text', text }] : undefined }).run();
    };

    const setLink = () => {
        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL (e.g. /documents/uuid):', previousUrl);
        if (url === null) return;
        if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
        if (!isSafeHref(url)) {
            alert('Unsafe or unsupported link. Use http(s), mailto, or a relative path.');
            return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    };

    return (
        <div className="relative flex flex-wrap items-center gap-1 p-2 border-b border-slate-200 bg-white sticky top-0 z-10">
            <button onClick={() => editor.chain().focus().toggleBold().run()} className={toggleBtnClass(editor.isActive('bold'))} title="Bold"><Bold className="w-4 h-4" /></button>
            <button onClick={() => editor.chain().focus().toggleItalic().run()} className={toggleBtnClass(editor.isActive('italic'))} title="Italic"><Italic className="w-4 h-4" /></button>
            <button onClick={() => editor.chain().focus().toggleStrike().run()} className={toggleBtnClass(editor.isActive('strike'))} title="Strikethrough"><Strikethrough className="w-4 h-4" /></button>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={toggleBtnClass(editor.isActive('heading', { level: 1 }))} title="Heading 1"><Heading1 className="w-4 h-4" /></button>
            <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={toggleBtnClass(editor.isActive('heading', { level: 2 }))} title="Heading 2"><Heading2 className="w-4 h-4" /></button>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={toggleBtnClass(editor.isActive('bulletList'))} title="Bullet List"><List className="w-4 h-4" /></button>
            <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={toggleBtnClass(editor.isActive('orderedList'))} title="Ordered List"><ListOrdered className="w-4 h-4" /></button>
            <button onClick={() => editor.chain().focus().toggleBlockquote().run()} className={toggleBtnClass(editor.isActive('blockquote'))} title="Quote"><Quote className="w-4 h-4" /></button>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={setLink} className={toggleBtnClass(editor.isActive('link'))} title="Insert Link"><LinkIcon className="w-4 h-4" /></button>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={() => editor.chain().focus().toggleCode().run()} className={toggleBtnClass(editor.isActive('code'))} title="Inline Code"><Code className="w-4 h-4" /></button>
            <button onClick={handleCodeBlock} className={toggleBtnClass(editor.isActive('codeBlock'))} title="Code Block"><Terminal className="w-4 h-4" /></button>

            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            {/* Кнопка открытия полноценного редактора */}
            <button onClick={() => openLatexEditor()} className={toggleBtnClass(false)} title="Open LaTeX Editor">
                <Sigma className="w-4 h-4" />
            </button>
            {/* Кнопка быстрой панели */}
            <button onClick={() => setShowLatexPanel(!showLatexPanel)} className={`flex items-center gap-0.5 p-1.5 rounded-md transition-colors ${showLatexPanel ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}>
                <ChevronDown className="w-3 h-3" />
            </button>

            {showLatexPanel && (
                <div ref={panelRef} className="absolute top-full left-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 max-h-96 overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Quick Insert</span>
                        <button onClick={() => setShowLatexPanel(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-2 mb-3">
                        <button onClick={() => insertMath('E = mc^2', false)} className="flex-1 text-xs bg-slate-50 hover:bg-blue-50 border border-slate-200 px-2 py-1.5 rounded">Inline</button>
                        <button onClick={() => insertMath('\\int_0^\\infty x^2 \\, dx', true)} className="flex-1 text-xs bg-slate-50 hover:bg-blue-50 border border-slate-200 px-2 py-1.5 rounded">Display</button>
                    </div>
                    {Object.entries(LATEX_SNIPPETS).map(([category, items]) => (
                        <div key={category} className="mb-3 last:mb-0">
                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">{category}</div>
                            <div className="grid grid-cols-4 gap-1.5">
                                {items.map((item) => (
                                    <button
                                        key={item.latex}
                                        onClick={() => insertMath(item.latex, false)}
                                        className="text-sm bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 px-2 py-1.5 rounded transition-colors text-slate-700"
                                        title={item.latex}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
