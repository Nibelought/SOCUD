import { describe, expect, it } from 'vitest';
import { initials, personColor, userFromToken } from './currentUser';

const encode = (payload: object) => {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const base64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `header.${base64}.signature`;
};

describe('userFromToken', () => {
    it('reads id and email, and names the user after the email', () => {
        expect(userFromToken(encode({ sub: 'u1', email: 'anna.kim@example.com' }))).toEqual({
            id: 'u1',
            email: 'anna.kim@example.com',
            name: 'anna.kim',
        });
    });

    it('decodes UTF-8 and base64url payloads', () => {
        expect(userFromToken(encode({ sub: 'u2', email: 'ёжик@пример.рф', pad: '???>>>' }))?.name).toBe('ёжик');
    });

    it('returns null for a missing, malformed or subject-less token', () => {
        expect(userFromToken(null)).toBeNull();
        expect(userFromToken('garbage')).toBeNull();
        expect(userFromToken(encode({ email: 'a@b.c' }))).toBeNull();
    });
});

describe('initials and personColor', () => {
    it('makes up to two initials from the local part', () => {
        expect(initials('anna.kim@example.com')).toBe('AK');
        expect(initials('bob')).toBe('B');
        expect(initials('')).toBe('?');
    });

    it('gives a stable color per person', () => {
        expect(personColor('anna')).toBe(personColor('anna'));
        expect(personColor('anna')).toMatch(/^#[0-9a-f]{6}$/);
    });
});
