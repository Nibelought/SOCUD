import { Extension, markInputRule, nodeInputRule } from '@tiptap/core';

export const MarkdownShortcuts = Extension.create({
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
