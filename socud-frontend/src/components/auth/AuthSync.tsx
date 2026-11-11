"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getAccessToken, isTokenExpired, clearTokens, refreshAccessToken, TOKEN_KEY, sessionLostLoginUrl } from '@/lib/auth';

const PUBLIC_PATHS = ['/login', '/register'];

export default function AuthSync() {
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        let cancelled = false;

        // 1. Check on first render (e.g. after a page reload)
        // If the access token is missing or expired, try once to refresh it via the refresh cookie,
        // and force a logout only if that fails.
        if (!PUBLIC_PATHS.includes(pathname)) {
            const access = getAccessToken();
            if (!access || isTokenExpired(access)) {
                refreshAccessToken().then((token) => {
                    if (cancelled || token) return;
                    clearTokens();
                    router.push(sessionLostLoginUrl());
                });
            }
        }

        // 2. Cross-tab sync
        // The storage event fires ONLY in other tabs when localStorage changes
        const handleStorage = (e: StorageEvent) => {
            if (e.key === TOKEN_KEY && !e.newValue) {
                // The user logged out in another tab, so log out here
                clearTokens();
                router.push(sessionLostLoginUrl());
            }
        };

        window.addEventListener('storage', handleStorage);
        return () => {
            cancelled = true;
            window.removeEventListener('storage', handleStorage);
        };
    }, [router, pathname]);

    // Renders nothing, only runs side effects
    return null;
}
