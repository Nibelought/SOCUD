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
                        // Look up the registered node names dynamically
                        const inlineNode = nodes.inlineMath || nodes.mathInline || nodes.math;
                        const blockNode = nodes.displayMath || nodes.blockMath || nodes.mathDisplay || inlineNode;

                        if (!inlineNode) return false;

                        const inlineAttrKey = mathAttrKey(inlineNode);
                        const blockAttrKey = mathAttrKey(blockNode);
                        const needsDisplayAttr = blockNode.name === inlineNode.name ? ' data-display="true"' : '';

                        // 1. Escape HTML entities BEFORE the replacements
                        let processedText = text
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/\r/g, '');

                        // 2. Isolate formulas (protects them from the markdown parser)
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

                        // 3. Safe markdown (paragraph grouping)
                        // Split the text into paragraphs on double newlines
                        const paragraphs = processedText.split(/\n{2,}/);
                        const htmlParts = paragraphs.map(p => {
                            // Handle block elements
                            if (/^### (.*)/.test(p)) return p.replace(/^### (.*)/, '<h3>$1</h3>');
                            if (/^## (.*)/.test(p)) return p.replace(/^## (.*)/, '<h2>$1</h2>');
                            if (/^# (.*)/.test(p)) return p.replace(/^# (.*)/, '<h1>$1</h1>');
                            if (/^(---|___|\*\*\*)/.test(p)) return '<hr>';
                            if (/^> (.*)/.test(p)) return `<blockquote>${p.replace(/^> (.*)/gim, '$1<br>')}</blockquote>`;
                            if (/(?:^|\n)- /.test(p)) {
                                const listItems = p.split(/(?:^|\n)- /).filter(Boolean).map(item => `<li>${item.replace(/\n/g, ' ')}</li>`).join('');
                                return `<ul>${listItems}</ul>`;
                            }

                            // Handle inline styles inside regular paragraphs
                            const parsed = p
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                .replace(/~~(.*?)~~/g, '<s>$1</s>')
                                .replace(/`(.*?)`/g, '<code>$1</code>')
                                .replace(/\n/g, '<br>');

                            // Wrap in <p> to keep the DOM well-formed
                            return `<p>${parsed}</p>`;
                        });

                        processedText = htmlParts.join('\n');

                        // 4. Insert formulas via <span>
                        // We use `<span>` even for displayMath: the browser does not break paragraphs on a span.
                        // When Tiptap reads data-type="displayMath" it safely lifts the node out of the paragraph into a block.
                        processedText = processedText.replace(/__MATH_BLOCK_(\d+)__/g, (_, id) => {
                            const latex = mathBlocks[Number(id)]
                                .replace(/"/g, '&quot;')
                                .replace(/\n/g, '&#10;');
                            // The `$$${latex}$$` content preserves the text if the Tiptap parser fails for any reason
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
