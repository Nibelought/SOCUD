import { Extension } from '@tiptap/core';

// --- Custom extension for friendlier code blocks ---
export const CodeBlockUX = Extension.create({
    name: 'codeBlockUX',
    addKeyboardShortcuts() {
        return {
            'Enter': () => {
                const { state } = this.editor;
                const { selection } = state;
                const { $from, empty } = selection;

                // Only when the cursor is inside a code block
                if (!empty || $from.parent.type.name !== 'codeBlock') return false;

                const blockPos = $from.before();

                // 1. Enter at the very start of the block creates an empty line ABOVE it
                if ($from.parentOffset === 0) {
                    this.editor.chain()
                        .insertContentAt(blockPos, { type: 'paragraph' })
                        .setTextSelection(blockPos + 1) // move the cursor into the new line
                        .run();
                    return true;
                }

                // 2. Double Enter at the end of a code block exits it (like Notion)
                const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
                if (textBefore.endsWith('\n') && $from.parentOffset === $from.parent.nodeSize - 2) {
                    const afterPos = $from.after();
                    this.editor.chain()
                        .deleteRange({ from: selection.from - 1, to: selection.from }) // remove the extra newline
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

                // Only when the cursor is at the very start (offset 0) of the code block
                if (!empty || $from.parent.type.name !== 'codeBlock' || $from.parentOffset !== 0) return false;

                const blockPos = $from.before();
                const resolveBlock = state.doc.resolve(blockPos);
                const nodeBeforeBlock = resolveBlock.nodeBefore;

                // 3. If another code block is directly to the LEFT, create an empty line between them
                if (nodeBeforeBlock && nodeBeforeBlock.type.name === 'codeBlock') {
                    this.editor.chain()
                        .insertContentAt(blockPos, { type: 'paragraph' })
                        .setTextSelection(blockPos + 1) // focus between the blocks
                        .run();
                    return true;
                }

                return false;
            }
        };
    }
});
