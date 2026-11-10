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

        // 1. Проверка при первом рендере (например, после перезагрузки страницы)
        // Если access отсутствует или протух — одна попытка обновить его по refresh-cookie,
        // и только если она не удалась — принудительный выход.
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

        // 2. Синхронизация между вкладками
        // Событие storage срабатывает ТОЛЬКО в других вкладках при изменении localStorage
        const handleStorage = (e: StorageEvent) => {
            if (e.key === TOKEN_KEY && !e.newValue) {
                // Пользователь вышел в другой вкладке → выходим здесь
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

    // Компонент ничего не рендерит, только выполняет side-effects
    return null;
}
