"use client";
"use no memo";


import { useEditor, EditorContent } from '@tiptap/react';
import { Extension, markInputRule, nodeInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import LinkExtension from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { MathExtension } from '@aarkue/tiptap-math-extension';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { useRouter } from 'next/navigation';
import {
    Loader2, Globe, Users, Eye, Edit2, Settings,
    Bold, Italic, Strikethrough, Code, Sigma,
    Heading1, Heading2, List, ListOrdered, Quote,
    Terminal, Link as LinkIcon, ChevronDown, X
} from 'lucide-react';
import AccessManagerModal from '@/components/modals/AccessManagerModal';
import LatexEditorModal from "@/components/editor/LatexEditorModal"

import { common, createLowlight } from 'lowlight';
const lowlight = createLowlight(common);

interface EditorProps {
    documentId: string;
    token: string;
    userName: string;
    userColor: string;
    currentUserId: string; // ← Новое поле
}

interface ActiveUser {
    clientId: number;
    name: string;
    color: string;
}

// --- КАСТОМНОЕ РАСШИРЕНИЕ ДЛЯ УДОБСТВА РАБОТЫ С БЛОКАМИ КОДА ---
const CodeBlockUX = Extension.create({
    name: 'codeBlockUX',
    addKeyboardShortcuts() {
        return {
            'Enter': () => {
                const { state } = this.editor;
                const { selection } = state;
                const { $from, empty } = selection;

                // Работаем только если курсор внутри блока кода
                if (!empty || $from.parent.type.name !== 'codeBlock') return false;

                const blockPos = $from.before();

                // 1. Enter в самом начале блока -> Создает пустую строку ВЫШЕ блока
                if ($from.parentOffset === 0) {
                    this.editor.chain()
                        .insertContentAt(blockPos, { type: 'paragraph' })
                        .setTextSelection(blockPos + 1) // Переносим курсор в созданную строку
                        .run();
                    return true;
                }

                // 2. Двойной Enter в конце блока кода -> Выход из блока (как в Notion)
                const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
                if (textBefore.endsWith('\n') && $from.parentOffset === $from.parent.nodeSize - 2) {
                    const afterPos = $from.after();
                    this.editor.chain()
                        .deleteRange({ from: selection.from - 1, to: selection.from }) // удаляем лишний перенос
                        .insertContentAt(afterPos, { type: 'paragraph' })
                        .setTextSelection(afterPos + 1)
                        .run();
                    return true;
                }

                return false;
            },

            'ArrowLeft': () => {
                const { state } = this.editor;
                const { selection } = state;
                const { $from, empty } = selection;

                // Срабатывает только если курсор стоит в самом начале (нулевой символ) блока кода
                if (!empty || $from.parent.type.name !== 'codeBlock' || $from.parentOffset !== 0) return false;

                const blockPos = $from.before();
                const resolveBlock = state.doc.resolve(blockPos);
                const nodeBeforeBlock = resolveBlock.nodeBefore;

                // 3. Если СЛЕВА находится другой блок кода -> Создаем пустую строку между ними
                if (nodeBeforeBlock && nodeBeforeBlock.type.name === 'codeBlock') {
                    this.editor.chain()
                        .insertContentAt(blockPos, { type: 'paragraph' })
                        .setTextSelection(blockPos + 1) // Фокусируемся между блоками
                        .run();
                    return true;
                }

                return false;
            }
        };
    }
});

const LATEX_SNIPPETS = {
    Greek: [
        { label: 'α', latex: '\\alpha' }, { label: 'β', latex: '\\beta' },
        { label: 'γ', latex: '\\gamma' }, { label: 'δ', latex: '\\delta' },
        { label: 'ε', latex: '\\epsilon' }, { label: 'θ', latex: '\\theta' },
        { label: 'λ', latex: '\\lambda' }, { label: 'μ', latex: '\\mu' },
        { label: 'π', latex: '\\pi' }, { label: 'σ', latex: '\\sigma' },
        { label: 'φ', latex: '\\phi' }, { label: 'ω', latex: '\\omega' },
    ],
    Operators: [
        { label: '±', latex: '\\pm' }, { label: '×', latex: '\\times' },
        { label: '÷', latex: '\\div' }, { label: '≤', latex: '\\leq' },
        { label: '≥', latex: '\\geq' }, { label: '≠', latex: '\\neq' },
        { label: '≈', latex: '\\approx' }, { label: '∞', latex: '\\infty' },
        { label: '∂', latex: '\\partial' }, { label: '∇', latex: '\\nabla' },
    ],
    Structures: [
        { label: 'Fraction', latex: '\\frac{a}{b}' },
        { label: '√ Root', latex: '\\sqrt{x}' },
        { label: 'ⁿ√ Root', latex: '\\sqrt[n]{x}' },
        { label: '∑ Sum', latex: '\\sum_{i=0}^{n}' },
        { label: '∫ Integral', latex: '\\int_{a}^{b}' },
        { label: 'Matrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
    ],
    Functions: [
        { label: 'sin', latex: '\\sin' }, { label: 'cos', latex: '\\cos' },
        { label: 'tan', latex: '\\tan' }, { label: 'log', latex: '\\log' },
        { label: 'ln', latex: '\\ln' }, { label: 'lim', latex: '\\lim' },
    ]
};

const markdownToHtml = (text: string): string => {
    if (!text.trim()) return '';
    return text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^(?:---|___|\*\*\*)$/gim, '<hr>')
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        .replace(/~~(.*?)~~/gim, '<s>$1</s>')
        .replace(/`(.*?)`/gim, '<code>$1</code>')
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
        .replace(/(?:^|\n)- (.*$)/gim, '<ul><li>$1</li></ul>')
        .replace(/\n/gim, '<br>');
};

const PasteMarkdown = Extension.create({
    name: 'pasteMarkdown',
    addProseMirrorPlugins() {
        return[
            new Plugin({
                key: new PluginKey('pasteMarkdown'),
                props: {
                    handlePaste: (view, event) => {
                        const text = event.clipboardData?.getData('text/plain');
                        if (!text || !/[#*~`>\-]|\*\*|~~|\n|\$/.test(text)) return false;

                        const editor = this.editor;
                        if (!editor) return false;

                        const { nodes } = editor.schema;
                        // Динамически получаем зарегистрированные имена узлов
                        const inlineNode = nodes.inlineMath || nodes.mathInline || nodes.math;
                        const blockNode = nodes.displayMath || nodes.blockMath || nodes.mathDisplay || inlineNode;

                        if (!inlineNode) return false;

                        const getAttrKey = (node: any) => {
                            const attrs = node?.spec?.attrs || {};
                            return 'latex' in attrs ? 'latex' : ('content' in attrs ? 'content' : 'text');
                        };

                        const inlineAttrKey = getAttrKey(inlineNode);
                        const blockAttrKey = getAttrKey(blockNode);
                        const needsDisplayAttr = blockNode.name === inlineNode.name ? ' data-display="true"' : '';

                        // 1. Экранируем HTML-сущности ДО замен
                        let processedText = text
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/\r/g, '');

                        // 2. ИЗОЛИРУЕМ ФОРМУЛЫ (защита от парсера)
                        const mathBlocks: string[] = [];
                        const mathInlines: string[] =[];

                        processedText = processedText.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
                            mathBlocks.push(latex);
                            return `__MATH_BLOCK_${mathBlocks.length - 1}__`;
                        });

                        processedText = processedText.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
                            mathInlines.push(latex);
                            return `__MATH_INLINE_${mathInlines.length - 1}__`;
                        });

                        // 3. БЕЗОПАСНЫЙ МАРКДАУН (Группировка параграфов)
                        // Разбиваем текст по двойному переносу строки на абзацы
                        const paragraphs = processedText.split(/\n{2,}/);
                        const htmlParts = paragraphs.map(p => {
                            // Обрабатываем блочные элементы
                            if (/^### (.*)/.test(p)) return p.replace(/^### (.*)/, '<h3>$1</h3>');
                            if (/^## (.*)/.test(p)) return p.replace(/^## (.*)/, '<h2>$1</h2>');
                            if (/^# (.*)/.test(p)) return p.replace(/^# (.*)/, '<h1>$1</h1>');
                            if (/^(---|___|\*\*\*)/.test(p)) return '<hr>';
                            if (/^> (.*)/.test(p)) return `<blockquote>${p.replace(/^> (.*)/gim, '$1<br>')}</blockquote>`;
                            if (/(?:^|\n)- /.test(p)) {
                                const listItems = p.split(/(?:^|\n)- /).filter(Boolean).map(item => `<li>${item.replace(/\n/g, ' ')}</li>`).join('');
                                return `<ul>${listItems}</ul>`;
                            }

                            // Обрабатываем инлайн-стили внутри обычных абзацев
                            let parsed = p
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                .replace(/~~(.*?)~~/g, '<s>$1</s>')
                                .replace(/`(.*?)`/g, '<code>$1</code>')
                                .replace(/\n/g, '<br>');

                            // Оборачиваем в <p> для сохранения целостности DOM
                            return `<p>${parsed}</p>`;
                        });

                        processedText = htmlParts.join('\n');

                        // 4. ВСТАВЛЯЕМ ФОРМУЛЫ ЧЕРЕЗ <span>
                        // Важно: Мы используем `<span>` даже для displayMath. Браузер не ломает параграфы при виде span.
                        // Когда Tiptap прочитает data-type="displayMath", он сам безопасно вынесет его из параграфа в блочный вид.
                        processedText = processedText.replace(/__MATH_BLOCK_(\d+)__/g, (_, id) => {
                            const latex = mathBlocks[Number(id)]
                                .replace(/"/g, '&quot;')
                                .replace(/\n/g, '&#10;');
                            // Содержимое `$$${latex}$$` сохранит текст, если парсер Tiptap по какой-то причине сбойнёт
                            return `<span data-type="${blockNode.name}" data-${blockAttrKey}="${latex}"${needsDisplayAttr}>$$${latex}$$</span>`;
                        });

                        processedText = processedText.replace(/__MATH_INLINE_(\d+)__/g, (_, id) => {
                            const latex = mathInlines[Number(id)]
                                .replace(/"/g, '&quot;')
                                .replace(/\n/g, '&#10;');
                            return `<span data-type="${inlineNode.name}" data-${inlineAttrKey}="${latex}">$${latex}$</span>`;
                        });

                        editor.chain().focus().insertContent(processedText).run();
                        return true;
                    },
                },
            }),
        ];
    },
});

const MarkdownShortcuts = Extension.create({
    name: 'markdownShortcuts',
    addInputRules() {
        const { marks, nodes } = this.editor.schema;
        return [
            // ✅ Inline-метки
            markInputRule({ find: /\*\*([^*]+)\*\*$/, type: marks.bold }),
            markInputRule({ find: /(?:^|\s)\*([^*\s][^*]*)\*(?!\*)$/, type: marks.italic }),
            markInputRule({ find: /~~([^~]+)~~$/, type: marks.strike }),
            markInputRule({ find: /`([^`]+)`$/, type: marks.code }),

            // ✅ Заголовки (официальный паттерн, курсор остаётся в конце строки)
            nodeInputRule({
                find: /^(#{1,3}) $/,
                type: nodes.heading,
                getAttributes: (match) => ({ level: match[1].length }),
            }),

            // ✅ Горизонтальная линия
            nodeInputRule({
                find: /^(?:---|___|\*\*\*) $/,
                type: nodes.horizontalRule,
            }),
        ];
    },
});

const EditorToolbar = ({ editor, openLatexEditor }: { editor: any; openLatexEditor: (latex?: string, display?: boolean) => void }) => {
    if (!editor) return null;
    const [showLatexPanel, setShowLatexPanel] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setShowLatexPanel(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
            const specAttrs = blockNode.spec.attrs || {};
            const attrKey = 'latex' in specAttrs ? 'latex' : ('content' in specAttrs ? 'content' : 'text');
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
            const specAttrs = targetNode.spec.attrs || {};
            const attrKey = 'latex' in specAttrs ? 'latex' : ('content' in specAttrs ? 'content' : 'text');
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
};

// Расширение для отслеживания двойного клика по формулам
const createMathDoubleClickExtension = (onEdit: (latex: string, isDisplay: boolean, pos: number) => void) =>
    Extension.create({
        name: 'mathDoubleClickEdit',
        addProseMirrorPlugins() {
            return [
                new Plugin({
                    props: {
                        handleDoubleClickOn(view, pos, node, nodePos, event) {
                            const name = node.type.name.toLowerCase();
                            // Срабатывает на любой узел, содержащий 'math' в имени
                            if (name.includes('math')) {
                                const latex = node.attrs.latex || node.attrs.content || node.attrs.text || '';
                                const isDisplay = node.attrs.display || name.includes('block') || name.includes('display');
                                onEdit(latex, isDisplay, nodePos);
                                return true; // Предотвращаем стандартное выделение текста
                            }
                            return false;
                        }
                    }
                })
            ];
        }
    });

// --- ВНУТРЕННИЙ РЕДАКТОР ---
const EditorInner = ({ provider, ydoc, userName, userColor, activeUsers, currentUserId }: {
    provider: HocuspocusProvider;
    ydoc: Y.Doc;
    userName: string;
    userColor: string;
    activeUsers: ActiveUser[];
    currentUserId: string;
}) => {
    const router = useRouter();
    const [isEditing, setIsEditing] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false); // ← Состояние модалки

    const [latexModal, setLatexModal] = useState({
        isOpen: false,
        initialLatex: '',
        isDisplay: false,
        isEditing: false,
        nodePos: undefined as number | undefined
    });

    // ✅ Стабильный callback для расширения (предотвращает пересоздание редактора)
    const handleMathDoubleClick = useCallback((latex: string, isDisplay: boolean, pos: number) => {
        setLatexModal({ isOpen: true, initialLatex: latex, isDisplay, isEditing: true, nodePos: pos });
    }, []);

    // ✅ Мемоизируем расширение
    const MathDoubleClickEdit = useMemo(() => createMathDoubleClickExtension(handleMathDoubleClick), [handleMathDoubleClick]);


    const openLatexEditor = (initialLatex = '', isDisplay = false) => {
        setLatexModal({ isOpen: true, initialLatex, isDisplay, isEditing: false, nodePos: undefined });
    };

    const extensions = useMemo(() => [
        StarterKit.configure({
            history: false,
            codeBlock: false,
            heading: { inputRules: false },       // ← Делегируем MarkdownShortcuts
            horizontalRule: { inputRules: false } // ← Делегируем MarkdownShortcuts
        }),
        Markdown,
        MarkdownShortcuts,
        PasteMarkdown,
        MathExtension.configure({
            evaluation: false, // Безопасность: отключаем выполнение JS внутри формул
            // Включение авто-преобразования при вводе $...$ + пробел
            addInputRules: true,
            addDisplayMath: true,
        }),
        CodeBlockLowlight.configure({ lowlight }),
        CodeBlockUX,
        LinkExtension.configure({
            openOnClick: false,
            autolink: true,
            validate: () => true,
            HTMLAttributes: { class: 'text-blue-600 underline hover:text-blue-800 transition-colors cursor-pointer' },
        }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({ provider, user: { name: userName, color: userColor } }),
        MathDoubleClickEdit,
    ], [ydoc, provider, userName, userColor, MathDoubleClickEdit]);

    const editor = useEditor({
        immediatelyRender: false,
        editable: isEditing,
        extensions,
    });

    useEffect(() => {
        if (editor) editor.setEditable(isEditing);
    }, [isEditing, editor]);

    const handlePublish = async () => {
        if (!editor) return;
        const html = editor.getHTML();
        try {
            const token = localStorage.getItem("socud_token");
            const docId = provider.configuration.name;
            const res = await fetch(`http://localhost:3000/document/${docId}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                body: JSON.stringify({ html }),
            });
            if (!res.ok) throw new Error("Failed to publish");
            const data = await res.json();
            alert(`Published! Extracted links: ${data.extractedLinksCount}`);
        } catch (error) {
            console.error(error);
            alert("Error publishing.");
        }
    };

    if (!editor) return <div className="p-8 text-slate-500 animate-pulse">Initializing editor...</div>;

    return (
        <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            {/* ВЕРХНЯЯ ПАНЕЛЬ */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Users className="w-4 h-4" />
                        <span className="font-medium">{activeUsers.length} active</span>
                    </div>
                    <div className="flex -space-x-2">
                        {activeUsers.map((u) => (
                            <div key={u.clientId} title={u.name} className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ backgroundColor: u.color }}>
                                {u.name.charAt(0).toUpperCase()}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* ✅ КНОПКА SETTINGS */}
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    >
                        <Settings className="w-4 h-4" /> Settings
                    </button>

                    <button onClick={() => setIsEditing(!isEditing)} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${isEditing ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                        {isEditing ? <><Eye className="w-4 h-4" /> Preview</> : <><Edit2 className="w-4 h-4" /> Edit</>}
                    </button>

                    <button
                        onClick={() => router.push(`/document/${provider.configuration.name}/view`)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    >
                        <Eye className="w-4 h-4" /> View
                    </button>

                    <button onClick={handlePublish} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors">
                        <Globe className="w-4 h-4" /> Publish
                    </button>
                </div>
            </div>

            {isEditing && <EditorToolbar editor={editor} openLatexEditor={openLatexEditor} />}

            {/* ✅ ХОЛСТ РЕДАКТОРА: Растянут на всю высоту с корректным скроллом */}
            <div className={`flex-1 overflow-y-auto p-8 ${!isEditing ? 'bg-slate-50/50' : ''}`}>
                <EditorContent
                    editor={editor}
                    className="prose prose-slate max-w-none focus:outline-none h-full [&_.ProseMirror]:min-h-full [&_.ProseMirror]:h-full"
                />
            </div>

            {/* ✅ МОДАЛЬНОЕ ОКНО ДОСТУПА */}
            <AccessManagerModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                entityId={provider.configuration.name}
                entityType="document"
                currentUserId={currentUserId}
                onDeleteSuccess={() => router.push('/dashboard')}
            />

            <LatexEditorModal
                isOpen={latexModal.isOpen}
                onClose={() => setLatexModal(prev => ({ ...prev, isOpen: false }))}
                editor={editor}
                initialLatex={latexModal.initialLatex}
                isDisplay={latexModal.isDisplay}
                isEditing={latexModal.isEditing}
                nodePos={latexModal.nodePos}
            />
        </div>
    );
};

// --- ГЛАВНЫЙ КОМПОНЕНТ ---
export default function DocumentEditor({ documentId, token, userName, userColor, currentUserId }: EditorProps) {
    const [ydoc] = useState(() => new Y.Doc());
    const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
    const [status, setStatus] = useState<string>('connecting');
    const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);

    useEffect(() => {
        let isMounted = true;
        const newProvider = new HocuspocusProvider({
            url: `ws://127.0.0.1:3002`,
            name: documentId,
            document: ydoc,
            token: token,
            onStatus: ({ status }) => { if (isMounted) setStatus(status); },
        });

        newProvider.awareness.on('change', () => {
            if (!isMounted) return;
            const states = Array.from(newProvider.awareness.getStates().entries());
            const users = states.filter(([_, state]) => state?.user?.name).map(([clientId, state]) => ({
                clientId, name: state.user.name, color: state.user.color,
            }));
            setActiveUsers(users);
        });

        setProvider(newProvider);
        return () => { isMounted = false; newProvider.destroy(); };
    }, [documentId, token, ydoc]);

    if (status !== 'connected' || !provider) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <p>Connecting to secure document session...</p>
            </div>
        );
    }

    return <EditorInner provider={provider} ydoc={ydoc} userName={userName} userColor={userColor} activeUsers={activeUsers} currentUserId={currentUserId} />;
}