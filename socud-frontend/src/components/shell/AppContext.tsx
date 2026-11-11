"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type components } from '@/lib/api/client';
import { unwrap } from '@/lib/api/result';
import { getAccessToken, TOKEN_EVENT, TOKEN_KEY } from '@/lib/auth';
import { userFromToken, type CurrentUser } from '@/lib/currentUser';
import { useResource } from '@/hooks/useResource';

export type SpaceSummary = components['schemas']['SpaceWithCountDto'];

/**
 * App-wide state for signed-in screens:
 *  - who is signed in (from the access token, display only),
 *  - the spaces the sidebar, Home and the "New Document" sheet share,
 *  - the global surfaces any screen can open: search, New Space, New Document.
 *
 * New global surfaces (settings window, notifications, a command palette) belong here too.
 */
interface AppContextValue {
    user: CurrentUser | null;
    spaces: SpaceSummary[] | undefined;
    spacesLoading: boolean;
    spacesError: unknown;
    reloadSpaces: () => void;

    searchOpen: boolean;
    openSearch: () => void;
    closeSearch: () => void;

    newSpaceOpen: boolean;
    openNewSpace: () => void;
    closeNewSpace: () => void;

    /** null when closed; `{ spaceId }` preselects a space. */
    newDocument: { spaceId?: string } | null;
    openNewDocument: (spaceId?: string) => void;
    closeNewDocument: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
    return ctx;
}

export const SPACES_KEY = 'spaces';

function useCurrentUser(): CurrentUser | null {
    const [user, setUser] = useState<CurrentUser | null>(null);
    useEffect(() => {
        const read = () => setUser(userFromToken(getAccessToken()));
        read();
        const onStorage = (e: StorageEvent) => {
            if (e.key === TOKEN_KEY) read();
        };
        window.addEventListener(TOKEN_EVENT, read);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(TOKEN_EVENT, read);
            window.removeEventListener('storage', onStorage);
        };
    }, []);
    return user;
}

function isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function AppProvider({ children }: { children: ReactNode }) {
    const user = useCurrentUser();
    const spaces = useResource(SPACES_KEY, async () => unwrap(await api.GET('/space/my'), 'Couldn’t load your spaces'));

    const [searchOpen, setSearchOpen] = useState(false);
    const [newSpaceOpen, setNewSpaceOpen] = useState(false);
    const [newDocument, setNewDocument] = useState<{ spaceId?: string } | null>(null);

    const openSearch = useCallback(() => setSearchOpen(true), []);
    const closeSearch = useCallback(() => setSearchOpen(false), []);
    const openNewSpace = useCallback(() => setNewSpaceOpen(true), []);
    const closeNewSpace = useCallback(() => setNewSpaceOpen(false), []);
    const openNewDocument = useCallback((spaceId?: string) => setNewDocument({ spaceId }), []);
    const closeNewDocument = useCallback(() => setNewDocument(null), []);

    // ⌘K / Ctrl+K opens search from anywhere; "/" too when not typing.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setSearchOpen((open) => !open);
            } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
                e.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const value = useMemo<AppContextValue>(
        () => ({
            user,
            spaces: spaces.data,
            spacesLoading: spaces.loading,
            spacesError: spaces.error,
            reloadSpaces: spaces.reload,
            searchOpen,
            openSearch,
            closeSearch,
            newSpaceOpen,
            openNewSpace,
            closeNewSpace,
            newDocument,
            openNewDocument,
            closeNewDocument,
        }),
        [user, spaces.data, spaces.loading, spaces.error, spaces.reload, searchOpen, openSearch, closeSearch, newSpaceOpen, openNewSpace, closeNewSpace, newDocument, openNewDocument, closeNewDocument],
    );

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
