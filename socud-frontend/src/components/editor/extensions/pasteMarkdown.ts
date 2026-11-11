import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { mathAttrKey } from './mathNodes';

export const PasteMarkdown = Extension.create({
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

                        const inlineAttrKey = mathAttrKey(inlineNode);
                        const blockAttrKey = mathAttrKey(blockNode);
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
                            const parsed = p
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
