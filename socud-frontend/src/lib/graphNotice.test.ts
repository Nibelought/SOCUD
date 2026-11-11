import { describe, expect, it } from 'vitest';
import { graphTruncationNotice } from './graphNotice';

describe('graphTruncationNotice', () => {
    it('is empty when the graph is complete', () => {
        expect(graphTruncationNotice(false, 12)).toBeNull();
        expect(graphTruncationNotice(undefined, 12)).toBeNull();
    });

    it('names the number of shown pages when truncated', () => {
        expect(graphTruncationNotice(true, 2000)).toBe('Showing the first 2,000 pages');
        expect(graphTruncationNotice(true, 50)).toBe('Showing the first 50 pages');
    });
});
