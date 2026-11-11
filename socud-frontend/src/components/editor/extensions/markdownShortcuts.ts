import { Extension, markInputRule, nodeInputRule } from '@tiptap/core';

export const MarkdownShortcuts = Extension.create({
    name: 'markdownShortcuts',
    addInputRules() {
        const { marks, nodes } = this.editor.schema;
        return [
            // Inline marks
            markInputRule({ find: /\*\*([^*]+)\*\*$/, type: marks.bold }),
            markInputRule({ find: /(?:^|\s)\*([^*\s][^*]*)\*(?!\*)$/, type: marks.italic }),
            markInputRule({ find: /~~([^~]+)~~$/, type: marks.strike }),
            markInputRule({ find: /`([^`]+)`$/, type: marks.code }),

            // Headings (official pattern, the cursor stays at the end of the line)
            nodeInputRule({
                find: /^(#{1,3}) $/,
                type: nodes.heading,
                getAttributes: (match) => ({ level: match[1].length }),
            }),

            // Horizontal rule
            nodeInputRule({
                find: /^(?:---|___|\*\*\*) $/,
                type: nodes.horizontalRule,
            }),
        ];
    },
});
