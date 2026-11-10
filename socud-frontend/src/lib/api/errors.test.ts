import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './errors';

describe('apiErrorMessage', () => {
    it('uses a string message', () => {
        expect(apiErrorMessage({ statusCode: 401, message: 'Invalid user data' }, 'fallback')).toBe('Invalid user data');
    });

    it('joins validation message lists', () => {
        expect(apiErrorMessage({ message: ['a must be x', 'b must be y'] }, 'fallback')).toBe('a must be x, b must be y');
    });

    it('joins with a custom separator', () => {
        expect(apiErrorMessage({ message: ['a', 'b'] }, 'fallback', '\n')).toBe('a\nb');
    });

    it('falls back when there is no usable message', () => {
        expect(apiErrorMessage(undefined, 'fallback')).toBe('fallback');
        expect(apiErrorMessage({}, 'fallback')).toBe('fallback');
        expect(apiErrorMessage({ message: '' }, 'fallback')).toBe('fallback');
        expect(apiErrorMessage({ message: [] }, 'fallback')).toBe('fallback');
        expect(apiErrorMessage('boom', 'fallback')).toBe('fallback');
    });
});
