"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getTokens, isTokenExpired, clearTokens } from '@/lib/auth';

export default function AuthSync() {
    const router = useRouter();

    useEffect(() => {
        // 1. Проверка при первом рендере (например, после перезагрузки страницы)
        const { access, refresh } = getTokens();

        // Если access протух, а refresh отсутствует или тоже протух → принудительный выход
        if (access && isTokenExpired(access) && (!refresh || isTokenExpired(refresh))) {
            clearTokens();
            router.push('/login');
            return;
        }

        // 2. Синхронизация между вкладками
        // Событие storage срабатывает ТОЛЬКО в других вкладках при изменении localStorage
        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'socud_token' && !e.newValue) {
                // Пользователь вышел в другой вкладке → выходим здесь
                clearTokens();
                router.push('/login');
            }
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, [router]);

    // Компонент ничего не рендерит, только выполняет side-effects
    return null;
}