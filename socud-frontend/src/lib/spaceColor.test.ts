import { describe, expect, it } from 'vitest';
import { SPACE_COLOR_HEX, SPACE_COLOR_NAMES, spaceColorHex, spaceColorName, spaceInitial, spaceTint } from './spaceColor';

describe('spaceColor', () => {
    it('is stable for an id', () => {
        const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
        expect(spaceColorName(id)).toBe(spaceColorName(id));
    });

    it('spreads ids over the palette', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++) seen.add(spaceColorName(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
        expect(seen.size).toBeGreaterThanOrEqual(SPACE_COLOR_NAMES.length - 1);
    });

    it('accepts a known override and ignores an unknown one', () => {
        expect(spaceColorName('x', 'mint')).toBe('mint');
        expect(spaceColorName('x', 'chartreuse')).toBe(spaceColorName('x'));
    });

    it('has hex values for every color in both appearances', () => {
        for (const name of SPACE_COLOR_NAMES) {
            expect(SPACE_COLOR_HEX[name].light).toMatch(/^#[0-9a-f]{6}$/);
            expect(SPACE_COLOR_HEX[name].dark).toMatch(/^#[0-9a-f]{6}$/);
        }
        expect(spaceColorHex('abc', 'dark')).toBe(SPACE_COLOR_HEX[spaceColorName('abc')].dark);
    });

    it('sets --tint to the CSS variable of the space color', () => {
        expect(spaceTint('abc')).toEqual({ '--tint': `var(--space-${spaceColorName('abc')})` });
    });

    it('takes the first letter or digit of the name', () => {
        expect(spaceInitial('research notes')).toBe('R');
        expect(spaceInitial('  «Проект» 2026')).toBe('П');
        expect(spaceInitial('2026 plan')).toBe('2');
        expect(spaceInitial('—')).toBe('·');
        expect(spaceInitial('[Demo] Mathematics')).toBe('M');
        expect(spaceInitial('[Demo]')).toBe('D');
    });
});
