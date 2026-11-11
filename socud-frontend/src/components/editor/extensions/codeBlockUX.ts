import { Extension } from '@tiptap/core';

// --- КАСТОМНОЕ РАСШИРЕНИЕ ДЛЯ УДОБСТВА РАБОТЫ С БЛОКАМИ КОДА ---
export const CodeBlockUX = Extension.create({
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
