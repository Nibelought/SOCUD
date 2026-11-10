// @vitest-environment node
// Node's own Request/Response/fetch (undici) are used; jsdom's AbortSignal does not mix with them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'http://api.test';

interface Recorded {
    method: string;
    url: string;
    authorization: string | null;
    credentials: RequestCredentials;
    body: string;
}

type Handler = (req: Recorded) => Response | Promise<Response>;

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function setup(handler: Handler, token: string | null = 'old-token') {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_URL', API);

    const store = new Map<string, string>();
    if (token) store.set('socud_token', token);
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
    });
    const location = { href: '', pathname: '/space/42', search: '?tab=docs' };
    vi.stubGlobal('window', { location });
    vi.stubGlobal('document', { cookie: '' });

    const calls: Recorded[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: Request) => {
            const recorded: Recorded = {
                method: input.method,
                url: input.url,
                authorization: input.headers.get('Authorization'),
                credentials: input.credentials,
                body: await input.clone().text(),
            };
            calls.push(recorded);
            return handler(recorded);
        }),
    );

    const { api } = await import('./client');
    const auth = await import('../auth');
    return { api, auth, calls, store, location };
}

const refreshCalls = (calls: Recorded[]) => calls.filter((c) => c.url === `${API}/auth/refresh`);

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('api client (openapi-fetch + fetchWithAuth)', () => {
    it('sends the bearer token and does not send cookies on authenticated calls', async () => {
        const { api, calls } = await setup(() => json(200, []));

        const { data, response } = await api.GET('/space/my');

        expect(response.status).toBe(200);
        expect(data).toEqual([]);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(`${API}/space/my`);
        expect(calls[0].authorization).toBe('Bearer old-token');
        expect(calls[0].credentials).toBe('same-origin');
    });

    it('sends no Authorization header when there is no token (and tries a refresh on 401)', async () => {
        const { api, calls } = await setup(
            (req) => (req.url.endsWith('/auth/refresh') ? json(401, { message: 'no' }) : json(401, {})),
            null,
        );

        await api.GET('/space/my');

        expect(calls[0].authorization).toBeNull();
        expect(refreshCalls(calls)).toHaveLength(1);
    });

    it('on 401 refreshes once with the cookie, stores the new token and retries the request', async () => {
        const { api, calls, store } = await setup((req) => {
            if (req.url.endsWith('/auth/refresh')) return json(200, { access_token: 'new-token' });
            return req.authorization === 'Bearer new-token' ? json(200, [{ id: 's1' }]) : json(401, { message: 'expired' });
        });

        const { data, response } = await api.GET('/space/my');

        expect(response.status).toBe(200);
        expect(data).toEqual([{ id: 's1' }]);
        expect(calls.map((c) => `${c.method} ${c.url.replace(API, '')} ${c.authorization ?? '-'}`)).toEqual([
            'GET /space/my Bearer old-token',
            'POST /auth/refresh -',
            'GET /space/my Bearer new-token',
        ]);
        expect(refreshCalls(calls)[0].credentials).toBe('include');
        expect(store.get('socud_token')).toBe('new-token');
    });

    it('resends the JSON body intact when retrying a POST after a refresh', async () => {
        const { api, calls } = await setup((req) => {
            if (req.url.endsWith('/auth/refresh')) return json(200, { access_token: 'new-token' });
            return req.authorization === 'Bearer new-token'
                ? json(201, { id: 'd1', title: 'Hello' })
                : json(401, { message: 'expired' });
        });

        const { data } = await api.POST('/document', {
            body: { spaceId: '3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b', title: 'Hello' },
        });

        expect(data?.title).toBe('Hello');
        const posts = calls.filter((c) => c.url === `${API}/document`);
        expect(posts).toHaveLength(2);
        expect(posts[0].body).toBe(posts[1].body);
        expect(JSON.parse(posts[1].body)).toEqual({
            spaceId: '3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b',
            title: 'Hello',
        });
    });

    it('shares ONE refresh between concurrent 401s (single-flight)', async () => {
        const { api, calls } = await setup(async (req) => {
            if (req.url.endsWith('/auth/refresh')) {
                await new Promise((r) => setTimeout(r, 10));
                return json(200, { access_token: 'new-token' });
            }
            return req.authorization === 'Bearer new-token' ? json(200, []) : json(401, {});
        });

        const results = await Promise.all([
            api.GET('/space/my'),
            api.GET('/document/recent'),
            api.GET('/document/graph'),
        ]);

        expect(results.map((r) => r.response.status)).toEqual([200, 200, 200]);
        expect(refreshCalls(calls)).toHaveLength(1);
    });

    it('does not loop: a second 401 after a successful refresh is returned as is', async () => {
        const { api, calls } = await setup((req) =>
            req.url.endsWith('/auth/refresh') ? json(200, { access_token: 'new-token' }) : json(401, { message: 'nope' }),
        );

        const { error, response } = await api.GET('/space/my');

        expect(response.status).toBe(401);
        expect(error).toEqual({ message: 'nope' });
        expect(refreshCalls(calls)).toHaveLength(1);
        expect(calls.filter((c) => c.url === `${API}/space/my`)).toHaveLength(2);
    });

    it('clears the session and goes to /login?session=expired when the refresh is rejected', async () => {
        const { api, calls, store, location } = await setup((req) =>
            req.url.endsWith('/auth/refresh') ? json(401, { message: 'Invalid refresh token' }) : json(401, { message: 'expired' }),
        );

        const { response } = await api.GET('/space/my');

        expect(response.status).toBe(401);
        expect(refreshCalls(calls)).toHaveLength(1);
        expect(store.has('socud_token')).toBe(false);
        expect(location.href).toBe(`/login?session=expired&next=${encodeURIComponent('/space/42?tab=docs')}`);
    });

    it('treats a network error during refresh as a failed refresh (never rejects)', async () => {
        const { api, store, location } = await setup((req) => {
            if (req.url.endsWith('/auth/refresh')) throw new TypeError('network down');
            return json(401, {});
        });

        const { response } = await api.GET('/space/my');

        expect(response.status).toBe(401);
        expect(store.has('socud_token')).toBe(false);
        expect(location.href).toContain('/login?session=expired');
    });

    it('passes non-401 errors through without refreshing', async () => {
        const { api, calls } = await setup(() => json(403, { statusCode: 403, message: 'Forbidden' }));

        const { error, response } = await api.GET('/space/{id}', {
            params: { path: { id: '3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b' } },
        });

        expect(response.status).toBe(403);
        expect(error).toMatchObject({ message: 'Forbidden' });
        expect(refreshCalls(calls)).toHaveLength(0);
    });

    it('refreshAccessToken resolves null when the response has no token', async () => {
        const { auth } = await setup(() => json(200, {}));
        await expect(auth.refreshAccessToken()).resolves.toBeNull();
    });

    it('logout calls the API with cookies, clears local state and goes to /login', async () => {
        const { auth, calls, store, location } = await setup(() => new Response(null, { status: 204 }));

        await auth.logout();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'POST', url: `${API}/auth/logout`, credentials: 'include' });
        expect(store.has('socud_token')).toBe(false);
        expect(location.href).toBe('/login');
    });

    it('logout still signs out locally when the API is unreachable', async () => {
        const { auth, store, location } = await setup(() => {
            throw new TypeError('offline');
        });

        await auth.logout();

        expect(store.has('socud_token')).toBe(false);
        expect(location.href).toBe('/login');
    });
});
