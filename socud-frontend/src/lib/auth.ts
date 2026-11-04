import { API_URL } from './config';

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

export const clearTokens = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
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
                const res = await fetch(`${API_URL}/auth/refresh`, {
                    method: 'POST',
                    credentials: 'include',
                });
                if (!res.ok) return null;
                const data: { access_token?: string } = await res.json();
                if (!data.access_token) return null;
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

const redirectToLogin = () => {
    if (isBrowser) window.location.href = '/login';
};

/** Revokes the session server-side (best effort), clears local state and goes to /login. */
export async function logout(): Promise<void> {
    try {
        await fetch(`${API_URL}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        });
    } catch {
        // offline / server down: still drop the local session
    }
    clearTokens();
    redirectToLogin();
}

const withBearer = (options: RequestInit, token: string): RequestInit => {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return { ...options, headers };
};

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const access = getAccessToken();
    const response = await fetch(url, access ? withBearer(options, access) : options);

    if (response.status !== 401) return response;

    // Access token missing/expired/revoked: try one cookie refresh, then retry once.
    const newToken = await refreshAccessToken();
    if (newToken) return fetch(url, withBearer(options, newToken));

    clearTokens();
    redirectToLogin();
    return response;
}
