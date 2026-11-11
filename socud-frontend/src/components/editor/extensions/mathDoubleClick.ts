import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

// Tracks double clicks on formulas
export const createMathDoubleClickExtension = (onEdit: (latex: string, isDisplay: boolean, pos: number) => void) =>
    Extension.create({
        name: 'mathDoubleClickEdit',
        addProseMirrorPlugins() {
            return [
                new Plugin({
                    props: {
                        handleDoubleClickOn(view, pos, node, nodePos) {
                            const name = node.type.name.toLowerCase();
                            // Fires for any node whose name contains 'math'
                            if (name.includes('math')) {
                                const latex = node.attrs.latex || node.attrs.content || node.attrs.text || '';
                                const isDisplay = node.attrs.display || name.includes('block') || name.includes('display');
                                onEdit(latex, isDisplay, nodePos);
                                return true; // prevent the default text selection
                            }
                            return false;
                        }
                    }
                })
            ];
        }
    });
