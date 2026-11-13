import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query; `serverValue` is used during SSR and the first render. */
export function useMediaQuery(query: string, serverValue = false): boolean {
    return useSyncExternalStore(
        (onChange) => {
            const list = window.matchMedia(query);
            list.addEventListener('change', onChange);
            return () => list.removeEventListener('change', onChange);
        },
        () => window.matchMedia(query).matches,
        () => serverValue,
    );
}

/** Regular width: the sidebar sits beside the content instead of over it. */
export const REGULAR_WIDTH = '(min-width: 900px)';

export function useColorScheme(): 'light' | 'dark' {
    return useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light';
}
