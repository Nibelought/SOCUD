import type { NodeType } from '@tiptap/pm/model';

/**
 * Name of the attribute that holds the LaTeX source in a math node. Math extensions differ
 * (`latex`, `content` or `text`), so it is looked up in the node spec.
 */
export function mathAttrKey(node: NodeType | undefined): 'latex' | 'content' | 'text' {
    const attrs = node?.spec?.attrs || {};
    return 'latex' in attrs ? 'latex' : ('content' in attrs ? 'content' : 'text');
}
