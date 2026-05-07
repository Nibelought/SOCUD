export const TOKEN_KEY = 'socud_token';
export const REFRESH_KEY = 'socud_refresh_token';
const API_URL = 'http://localhost:3000';

export const getTokens = () => ({
    access: localStorage.getItem(TOKEN_KEY),
    refresh: localStorage.getItem(REFRESH_KEY),
});

export const setTokens = (access: string, refresh: string) => {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
};

export const clearTokens = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
};

export const isTokenExpired = (token: string): boolean => {
    try {
        const { exp } = JSON.parse(atob(token.split('.')[1]));
        return exp * 1000 < Date.now();
    } catch {
        return true;
    }
};

// Очередь запросов, ожидающих обновления токена
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

const onRefreshed = (token: string) => refreshSubscribers.forEach(cb => cb(token));
const addRefreshSubscriber = (cb: (token: string) => void) => refreshSubscribers.push(cb);

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const { access, refresh } = getTokens();

    if (access) {
        options.headers = {
            ...options.headers,
            Authorization: `Bearer ${access}`,
        };
    }

    let response = await fetch(url, options);

    // Если 401 и есть refresh-токен → пытаемся обновить
    if (response.status === 401 && refresh) {
        if (!isRefreshing) {
            isRefreshing = true;
            try {
                const res = await fetch(`${API_URL}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: refresh }),
                });

                if (!res.ok) throw new Error('Refresh failed');
                const data = await res.json();
                setTokens(data.access_token, data.refresh_token);
                isRefreshing = false;
                onRefreshed(data.access_token);
                refreshSubscribers = [];

                // Повторяем исходный запрос с новым токеном
                options.headers = { ...options.headers, Authorization: `Bearer ${data.access_token}` };
                return fetch(url, options);
            } catch {
                isRefreshing = false;
                refreshSubscribers = [];
                clearTokens();
                if (typeof window !== 'undefined') window.location.href = '/login';
                return response;
            }
        }

        // Если обновление уже идёт, ждём его завершения
        return new Promise((resolve) => {
            addRefreshSubscriber((newToken) => {
                options.headers = { ...options.headers, Authorization: `Bearer ${newToken}` };
                resolve(fetch(url, options));
            });
        });
    }

    // Если 401 и нет refresh-токена → выход
    if (response.status === 401) {
        clearTokens();
        if (typeof window !== 'undefined') window.location.href = '/login';
    }

    return response;
}