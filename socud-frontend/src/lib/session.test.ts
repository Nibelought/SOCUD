import { describe, expect, it } from 'vitest';
import { decideRoute, loginUrl, safeNextPath } from './session';

describe('safeNextPath', () => {
    it.each([
        ['/dashboard', '/dashboard'],
        ['/document/123e4567-e89b-12d3-a456-426614174000', '/document/123e4567-e89b-12d3-a456-426614174000'],
        ['/space/1?tab=docs&x=1', '/space/1?tab=docs&x=1'],
        ['/document/1#section', '/document/1#section'],
        ['/graph', '/graph'],
    ])('accepts %s', (input, expected) => {
        expect(safeNextPath(input)).toBe(expected);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['empty', ''],
        ['absolute https URL', 'https://evil.com/dashboard'],
        ['absolute http URL', 'http://evil.com'],
        ['protocol-relative', '//evil.com'],
        ['protocol-relative with path', '//evil.com/dashboard'],
        ['triple slash', '///evil.com'],
        ['slash-backslash', '/\\evil.com'],
        ['backslash-slash', '\\/evil.com'],
        ['backslash inside the path', '/dashboard\\..\\evil'],
        ['javascript scheme', 'javascript:alert(1)'],
        ['data scheme', 'data:text/html,<script>alert(1)</script>'],
        ['relative path without slash', 'dashboard'],
        ['dot segments only', '../etc/passwd'],
        ['encoded protocol-relative', '/%2F%2Fevil.com'],
        ['double-encoded protocol-relative', '/%252F%252Fevil.com'],
        ['encoded backslash', '/%5Cevil.com'],
        ['newline', '/dashboard\n//evil.com'],
        ['tab', '/\t/evil.com'],
        ['carriage return', '/dashboard\r'],
        ['NUL byte', '/dashboard\u0000'],
        ['encoded newline', '/dashboard%0A'],
        ['encoded tab then slash', '/%09/evil.com'],
        ['malformed percent escape', '/%E0%A4%A'],
        ['login page (loop)', '/login'],
        ['login with query (loop)', '/login?next=/dashboard'],
        ['register page (loop)', '/register'],
        ['over-long value', `/${'a'.repeat(3000)}`],
    ])('rejects %s', (_label, input) => {
        expect(safeNextPath(input)).toBeNull();
    });
});

describe('decideRoute', () => {
    const decide = (pathname: string, hasSession: boolean, search = '') =>
        decideRoute({ pathname, search, hasSession });

    describe.each(['/dashboard', '/space/abc', '/space', '/document/abc', '/document/abc/view', '/document/create', '/graph'])(
        'protected %s',
        (path) => {
            it('passes through with a session hint', () => {
                expect(decide(path, true)).toEqual({ action: 'next' });
            });

            it('redirects to /login with the return path when there is no hint', () => {
                expect(decide(path, false)).toEqual({
                    action: 'redirect',
                    to: `/login?next=${encodeURIComponent(path)}`,
                });
            });
        },
    );

    it('keeps the query string in the return path', () => {
        expect(decide('/space/1', false, '?tab=docs')).toEqual({
            action: 'redirect',
            to: `/login?next=${encodeURIComponent('/space/1?tab=docs')}`,
        });
    });

    it.each(['/login', '/register'])('%s: signed-out users stay', (path) => {
        expect(decide(path, false)).toEqual({ action: 'next' });
        expect(decide(path, false, '?next=/dashboard')).toEqual({ action: 'next' });
    });

    it.each(['/login', '/register'])('%s: signed-in users go to /dashboard by default', (path) => {
        expect(decide(path, true)).toEqual({ action: 'redirect', to: '/dashboard' });
    });

    it('signed-in users on /login follow a valid ?next=', () => {
        expect(decide('/login', true, `?next=${encodeURIComponent('/document/1?x=2')}`)).toEqual({
            action: 'redirect',
            to: '/document/1?x=2',
        });
    });

    it.each([
        ['absolute URL', `?next=${encodeURIComponent('https://evil.com')}`],
        ['protocol-relative', `?next=${encodeURIComponent('//evil.com')}`],
        ['backslash', `?next=${encodeURIComponent('/\\evil.com')}`],
        ['login loop', `?next=${encodeURIComponent('/login')}`],
        ['empty', '?next='],
    ])('signed-in users fall back to /dashboard for an unsafe ?next= (%s)', (_l, search) => {
        expect(decide('/login', true, search)).toEqual({ action: 'redirect', to: '/dashboard' });
    });

    it('does not bounce a stale session hint away from /login when the client flagged the session as expired', () => {
        expect(decide('/login', true, '?session=expired&next=%2Fdashboard')).toEqual({ action: 'next' });
        expect(decide('/register', true, '?session=expired')).toEqual({ action: 'next' });
    });

    it.each(['/', '/api/x', '/dashboardx', '/spaces', '/documents', '/login/extra', '/graphs'])(
        'ignores unrelated path %s',
        (path) => {
            expect(decide(path, false)).toEqual({ action: 'next' });
            expect(decide(path, true)).toEqual({ action: 'next' });
        },
    );
});

describe('loginUrl', () => {
    it('is plain /login by default', () => {
        expect(loginUrl()).toBe('/login');
    });

    it('flags an expired session and keeps a safe next path', () => {
        expect(loginUrl({ expired: true, next: '/space/1?tab=docs' })).toBe(
            `/login?session=expired&next=${encodeURIComponent('/space/1?tab=docs')}`,
        );
    });

    it('drops an unsafe next path', () => {
        expect(loginUrl({ expired: true, next: '//evil.com' })).toBe('/login?session=expired');
        expect(loginUrl({ next: '/login' })).toBe('/login');
    });
});
