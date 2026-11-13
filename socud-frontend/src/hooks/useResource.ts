import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Small data loader with a shared stale-while-revalidate cache: a screen you return to shows its
 * last data at once and refreshes in the background. `key` identifies the data (null = don't load);
 * call `reload()` after a mutation, or `invalidate(key)` from anywhere.
 *
 * Kept deliberately tiny; swap for SWR or TanStack Query if caching needs grow.
 */
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

export function invalidate(keyPrefix: string): void {
    for (const [key, set] of listeners) {
        if (key.startsWith(keyPrefix)) set.forEach((reload) => reload());
    }
}

export function useResource<T>(key: string | null, fetcher: () => Promise<T>) {
    // Data is stored with its key: when the key changes (same screen, another space) the previous
    // key's data is never shown for the new one.
    const [entry, setEntry] = useState<{ key: string | null; data: T | undefined }>(() => ({
        key,
        data: key ? (cache.get(key) as T | undefined) : undefined,
    }));
    const [error, setError] = useState<unknown>(null);
    const [loading, setLoading] = useState<boolean>(key !== null);
    const [version, setVersion] = useState(0);
    const fetcherRef = useRef(fetcher);
    useEffect(() => {
        fetcherRef.current = fetcher;
    });

    const reload = useCallback(() => setVersion((v) => v + 1), []);

    useEffect(() => {
        if (!key) return;
        let set = listeners.get(key);
        if (!set) listeners.set(key, (set = new Set()));
        set.add(reload);
        return () => {
            set.delete(reload);
            if (set.size === 0) listeners.delete(key);
        };
    }, [key, reload]);

    useEffect(() => {
        if (!key) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetcherRef.current().then(
            (result) => {
                if (cancelled) return;
                cache.set(key, result);
                setEntry({ key, data: result });
                setError(null);
                setLoading(false);
            },
            (err: unknown) => {
                if (cancelled) return;
                setError(err);
                setLoading(false);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [key, version]);

    /** Replace the data locally (optimistic update) without refetching. */
    const mutate = useCallback(
        (next: T) => {
            if (key) cache.set(key, next);
            setEntry({ key, data: next });
        },
        [key],
    );

    const data = entry.key === key ? entry.data : key ? (cache.get(key) as T | undefined) : undefined;
    return { data, error, loading: key !== null && loading, reload, mutate };
}
