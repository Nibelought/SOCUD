import { describe, expect, it } from 'vitest';
import type { NodeType } from '@tiptap/pm/model';
import { mathAttrKey } from './mathNodes';

const node = (attrs?: Record<string, unknown>) => ({ spec: { attrs } }) as unknown as NodeType;

describe('mathAttrKey', () => {
    it('prefers latex, then content, then falls back to text', () => {
        expect(mathAttrKey(node({ latex: {}, content: {} }))).toBe('latex');
        expect(mathAttrKey(node({ content: {} }))).toBe('content');
        expect(mathAttrKey(node({ other: {} }))).toBe('text');
        expect(mathAttrKey(node())).toBe('text');
        expect(mathAttrKey(undefined)).toBe('text');
    });
});
