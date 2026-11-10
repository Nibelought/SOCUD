import { publicApi } from './api/public-client';
import { SESSION_COOKIE_NAME, loginUrl } from './session';

export const TOKEN_KEY = 'socud_token';
/** Legacy key: refresh tokens now live in an httpOnly cookie and are never visible to JS. */
const LEGACY_REFRESH_KEY = 'socud_refresh_token';

const isBrowser = typeof window !== 'undefined';

// Remove any refresh token a previous version left in localStorage.
if (isBrowser) {
    try {
        localStorage.removeItem(LEGACY_REFRESH_KEY);
    } catch {
        // storage unavailable (private mode etc.) - nothing to clean up
    }
}

export const getAccessToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const setAccessToken = (access: string) => {
    localStorage.setItem(TOKEN_KEY, access);
};

/**
 * Best-effort removal of the `socud_session` hint cookie (the API clears it too, on logout and on a
 * rejected refresh). Only works for the default host-only cookie; with SESSION_COOKIE_DOMAIN the
 * browser ignores this and the `?session=expired` login flag prevents a redirect loop instead.
 */
const clearSessionHint = () => {
    if (!isBrowser) return;
    try {
        document.cookie = `${SESSION_COOKIE_NAME}=; Max-Age=0; path=/; SameSite=Lax`;
    } catch {
        // cookies unavailable - nothing to clear
    }
};

export const clearTokens = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
    clearSessionHint();
};

export const isTokenExpired = (token: string): boolean => {
    try {
        const { exp } = JSON.parse(atob(token.split('.')[1]));
        return exp * 1000 < Date.now();
    } catch {
        return true;
    }
};

// Single-flight: all callers that need a refresh while one is in progress share its result.
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token (the server rotates the cookie).
 * Resolves with the new access token, or null if the session cannot be refreshed.
 * Never rejects, so every waiting caller is always released.
 */
export function refreshAccessToken(): Promise<string | null> {
    if (!refreshInFlight) {
        refreshInFlight = (async () => {
            try {
                const { data } = await publicApi.POST('/auth/refresh');
                if (!data?.access_token) return null;
                setAccessToken(data.access_token);
                return data.access_token;
            } catch {
                return null;
            } finally {
                refreshInFlight = null;
            }
        })();
    }
    return refreshInFlight;
}

/**
 * Sends the browser to /login. `expired` marks a failed/lost session so the proxy does not bounce
 * a stale session hint straight back to the app; the current page is kept as `?next=`.
 */
const redirectToLogin = ({ expired }: { expired: boolean }) => {
    if (!isBrowser) return;
    const { pathname, search } = window.location;
    window.location.href = loginUrl({ expired, next: `${pathname}${search}` });
};

/** Revokes the session server-side (best effort), clears local state and goes to /login. */
export async function logout(): Promise<void> {
    try {
        await publicApi.POST('/auth/logout');
    } catch {
        // offline / server down: still drop the local session
    }
    clearTokens();
    if (isBrowser) window.location.href = '/login';
}

/**
 * fetch() with the bearer access token. On a 401 it refreshes the session once (single-flight) and
 * retries; if the session cannot be refreshed the tokens are dropped and the user is sent to /login.
 * Accepts a Request (what openapi-fetch passes) or url + init; the body is cloned so the retry can
 * resend it.
 */
export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const base = new Request(input, init);
    const send = (token: string | null) => {
        const request = base.clone();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return fetch(request);
    };

    const response = await send(getAccessToken());
    if (response.status !== 401) return response;

    // Access token missing/expired/revoked: try one cookie refresh, then retry once.
    const newToken = await refreshAccessToken();
    if (newToken) return send(newToken);

    clearTokens();
    redirectToLogin({ expired: true });
    return response;
}
