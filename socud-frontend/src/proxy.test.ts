import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config, proxy } from './proxy';

const ORIGIN = 'http://localhost:3001';

const run = (path: string, cookie?: string) =>
    proxy(new NextRequest(`${ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined));

const location = (res: Response) => res.headers.get('location');

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('proxy', () => {
    it('redirects a signed-out visitor from a protected page to /login with ?next=', () => {
        const res = run('/dashboard');
        expect(res.status).toBe(307);
        expect(location(res)).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
    });

    it('keeps nested paths and queries in ?next=', () => {
        expect(location(run('/document/abc/view?x=1'))).toBe(
            `${ORIGIN}/login?next=${encodeURIComponent('/document/abc/view?x=1')}`,
        );
    });

    it('lets a visitor with the session hint through', () => {
        const res = run('/dashboard', 'socud_session=1');
        expect(res.status).toBe(200);
        expect(location(res)).toBeNull();
        expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    it('does not accept any other value of the hint', () => {
        expect(run('/graph', 'socud_session=0').status).toBe(307);
        expect(run('/graph', 'socud_session=').status).toBe(307);
        expect(run('/graph', 'other=1').status).toBe(307);
    });

    it('sends signed-in users away from /login and /register', () => {
        expect(location(run('/login', 'socud_session=1'))).toBe(`${ORIGIN}/dashboard`);
        expect(location(run('/register', 'socud_session=1'))).toBe(`${ORIGIN}/dashboard`);
    });

    it('honours a safe ?next= for signed-in users and ignores an unsafe one', () => {
        expect(location(run('/login?next=%2Fgraph', 'socud_session=1'))).toBe(`${ORIGIN}/graph`);
        const evil = run(`/login?next=${encodeURIComponent('//evil.com')}`, 'socud_session=1');
        expect(location(evil)).toBe(`${ORIGIN}/dashboard`);
        const abs = run(`/login?next=${encodeURIComponent('https://evil.com')}`, 'socud_session=1');
        expect(location(abs)).toBe(`${ORIGIN}/dashboard`);
    });

    it('never redirects off-origin', () => {
        for (const next of ['//evil.com', '/\\evil.com', 'https://evil.com', '/%2F%2Fevil.com']) {
            const res = run(`/login?next=${encodeURIComponent(next)}`, 'socud_session=1');
            expect(new URL(location(res)!).origin).toBe(ORIGIN);
        }
    });

    it('lets signed-out visitors see /login and /register', () => {
        expect(run('/login').status).toBe(200);
        expect(run('/register').status).toBe(200);
    });

    it('breaks the redirect loop for a stale hint when the client flagged the session as expired', () => {
        const res = run('/login?session=expired&next=%2Fdashboard', 'socud_session=1');
        expect(res.status).toBe(200);
        expect(location(res)).toBeNull();
    });

    it('can be switched off with SESSION_REDIRECTS=off', () => {
        vi.stubEnv('SESSION_REDIRECTS', 'off');
        expect(run('/dashboard').status).toBe(200);
        expect(run('/login', 'socud_session=1').status).toBe(200);
    });

    it('matches exactly the guarded pages', () => {
        expect(config.matcher).toEqual([
            '/dashboard/:path*',
            '/space/:path*',
            '/document/:path*',
            '/graph/:path*',
            '/login',
            '/register',
        ]);
    });
});
