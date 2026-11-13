import { describe, expect, it } from 'vitest';
import { plural, relativeTime } from './format';

const now = new Date(2026, 10, 12, 15, 0, 0).getTime(); // 12 Nov 2026, 15:00 local

describe('relativeTime', () => {
    it('says "Just now" under a minute and for future dates', () => {
        expect(relativeTime(new Date(now - 30_000), now)).toBe('Just now');
        expect(relativeTime(new Date(now + 60_000), now)).toBe('Just now');
    });

    it('counts minutes and hours today', () => {
        expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe('5 minutes ago');
        expect(relativeTime(new Date(now - 3 * 3_600_000), now)).toBe('3 hours ago');
    });

    it('uses calendar days after 24 hours', () => {
        expect(relativeTime(new Date(2026, 10, 11, 9, 0), now)).toBe('Yesterday');
        expect(relativeTime(new Date(2026, 10, 9, 9, 0), now)).toBe('3 days ago');
    });

    it('falls back to a date after a week, with the year only when it differs', () => {
        expect(relativeTime(new Date(2026, 9, 1), now)).toBe('Oct 1');
        expect(relativeTime(new Date(2025, 9, 1), now)).toBe('Oct 1, 2025');
    });

    it('returns an empty string for an invalid date', () => {
        expect(relativeTime('not a date', now)).toBe('');
    });
});

describe('plural', () => {
    it('picks the form by count', () => {
        expect(plural(1, 'document')).toBe('1 document');
        expect(plural(0, 'document')).toBe('0 documents');
        expect(plural(1200, 'link')).toBe('1,200 links');
    });
});
