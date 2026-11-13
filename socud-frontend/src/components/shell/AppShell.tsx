"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { REGULAR_WIDTH, useMediaQuery } from '@/hooks/useMediaQuery';
import { FeedbackProvider } from '@/components/ui/Feedback';
import { AppProvider } from './AppContext';
import { Sidebar } from './Sidebar';
import { SearchPalette } from '@/components/search/SearchPalette';
import { NewDocumentSheet } from '@/components/documents/NewDocumentSheet';
import { NewSpaceSheet } from '@/components/spaces/NewSpaceSheet';

/**
 * Window frame for signed-in screens: sidebar + content, the way Mail, Notes and Finder are laid
 * out. At regular width the sidebar sits beside the content and can be hidden (the choice is
 * remembered); at compact width it slides over the content and closes after navigating.
 */
interface ShellContextValue {
    sidebarVisible: boolean;
    toggleSidebar: () => void;
    regular: boolean;
}
const ShellContext = createContext<ShellContextValue>({ sidebarVisible: true, toggleSidebar: () => {}, regular: true });
export const useShell = () => useContext(ShellContext);

const SIDEBAR_KEY = 'socud_sidebar_hidden';

export function AppShell({ children }: { children: ReactNode }) {
    const regular = useMediaQuery(REGULAR_WIDTH, true);
    const [hiddenOnRegular, setHiddenOnRegular] = useState(false);
    const [openOnCompact, setOpenOnCompact] = useState(false);

    useEffect(() => {
        try {
            setHiddenOnRegular(localStorage.getItem(SIDEBAR_KEY) === '1');
        } catch {
            // storage blocked: sidebar stays visible
        }
    }, []);

    const sidebarVisible = regular ? !hiddenOnRegular : openOnCompact;

    const toggleSidebar = useCallback(() => {
        if (regular) {
            setHiddenOnRegular((hidden) => {
                try {
                    localStorage.setItem(SIDEBAR_KEY, hidden ? '0' : '1');
                } catch {
                    // not remembered
                }
                return !hidden;
            });
        } else {
            setOpenOnCompact((open) => !open);
        }
    }, [regular]);

    // ⌃⌘S toggles the sidebar, as in macOS apps (View > Show/Hide Sidebar).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.metaKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                toggleSidebar();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toggleSidebar]);

    return (
        <FeedbackProvider>
            <AppProvider>
                <ShellContext.Provider value={{ sidebarVisible, toggleSidebar, regular }}>
                    <a
                        href="#main"
                        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-control focus:bg-accent focus:px-3 focus:py-1.5 focus:text-on-accent"
                    >
                        Skip to Content
                    </a>
                    <div className="flex h-dvh overflow-hidden bg-window">
                        {regular ? (
                            sidebarVisible && (
                                <aside className="w-[248px] shrink-0 border-r border-separator bg-sidebar">
                                    <Sidebar />
                                </aside>
                            )
                        ) : (
                            <>
                                <div
                                    aria-hidden
                                    onClick={toggleSidebar}
                                    className={cn(
                                        'fixed inset-0 z-40 bg-black/25 transition-opacity duration-200',
                                        sidebarVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
                                    )}
                                />
                                <aside
                                    aria-hidden={!sidebarVisible}
                                    inert={!sidebarVisible}
                                    // Compact: following a link closes the overlay.
                                    onClickCapture={(e) => {
                                        if ((e.target as HTMLElement).closest('a')) setOpenOnCompact(false);
                                    }}
                                    className={cn(
                                        'material-sidebar fixed inset-y-0 left-0 z-50 w-[min(300px,85vw)] shadow-sheet transition-transform duration-200 ease-out motion-reduce:transition-none',
                                        sidebarVisible ? 'translate-x-0' : '-translate-x-full',
                                    )}
                                >
                                    <Sidebar />
                                </aside>
                            </>
                        )}
                        <div className="min-w-0 flex-1">{children}</div>
                    </div>
                    <SearchPalette />
                    <NewSpaceSheet />
                    <NewDocumentSheet />
                </ShellContext.Provider>
            </AppProvider>
        </FeedbackProvider>
    );
}
