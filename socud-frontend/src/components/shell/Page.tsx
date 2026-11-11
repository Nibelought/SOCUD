"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { PanelLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/Button';
import { useShell } from './AppShell';
import { AccountMenu } from './AccountMenu';

/**
 * A screen: a scroll view with a toolbar floating over its top edge (the content scrolls beneath
 * the toolbar's material, which gains a separator once something is under it: the scroll edge).
 *
 * Screens with a large title (PageHeader) get iOS/macOS behavior: the title moves into the toolbar
 * when the large title scrolls away.
 */
interface PageContextValue {
    largeTitleHidden: boolean;
    setLargeTitleEl: (el: HTMLElement | null) => void;
}
const PageContext = createContext<PageContextValue>({ largeTitleHidden: true, setLargeTitleEl: () => {} });

interface PageProps {
    toolbar: ReactNode;
    children: ReactNode;
    /** Full-bleed content (graph, editor) manages its own width and scrolling. */
    bleed?: boolean;
    className?: string;
}

export function Page({ toolbar, children, bleed, className }: PageProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrolled, setScrolled] = useState(false);
    const [largeTitleEl, setLargeTitleEl] = useState<HTMLElement | null>(null);
    const [largeTitleHidden, setLargeTitleHidden] = useState(true);

    useEffect(() => {
        if (!largeTitleEl || !scrollRef.current) {
            setLargeTitleHidden(true);
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => setLargeTitleHidden(!entry.isIntersecting),
            { root: scrollRef.current, rootMargin: '-52px 0px 0px 0px', threshold: 0 },
        );
        observer.observe(largeTitleEl);
        return () => observer.disconnect();
    }, [largeTitleEl]);

    return (
        <PageContext.Provider value={{ largeTitleHidden, setLargeTitleEl }}>
            <div
                ref={scrollRef}
                onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
                className={cn('scrollbar-thin relative flex h-full min-w-0 flex-col', bleed ? 'overflow-hidden' : 'overflow-y-auto', className)}
            >
                <div data-scrolled={scrolled || undefined} className="group/toolbar sticky top-0 z-30">
                    {toolbar}
                </div>
                <main id="main" tabIndex={-1} className={cn('flex min-h-0 flex-1 flex-col outline-none', bleed && 'relative')}>
                    {children}
                </main>
            </div>
        </PageContext.Provider>
    );
}

/** Registers the large title so the toolbar can show the small one when it scrolls away. */
export function useLargeTitleRef() {
    return useContext(PageContext).setLargeTitleEl;
}

/** True once the screen's large title has scrolled under the toolbar (or when there is none). */
export function useLargeTitleHidden() {
    return useContext(PageContext).largeTitleHidden;
}

interface ToolbarProps {
    /** Small title; with a PageHeader it appears only once the large title scrolls away. */
    title?: ReactNode;
    /** Leading content after the sidebar button (breadcrumb, back button). Replaces `title`. */
    leading?: ReactNode;
    /** Trailing actions, most important last (before the account menu). */
    actions?: ReactNode;
    /** Floating over full-bleed content (graph): no bar, only the controls. */
    floating?: boolean;
}

export function Toolbar({ title, leading, actions, floating }: ToolbarProps) {
    const { sidebarVisible, toggleSidebar } = useShell();
    const { largeTitleHidden } = useContext(PageContext);

    return (
        <header
            className={cn(
                'flex h-[52px] items-center gap-1.5 px-3',
                floating
                    ? 'pointer-events-none absolute inset-x-0 top-0 [&>*]:pointer-events-auto'
                    : 'material shadow-[0_0.5px_0_transparent] transition-shadow duration-150 group-data-[scrolled]/toolbar:shadow-[0_0.5px_0_var(--c-separator-strong)]',
            )}
        >
            {!sidebarVisible && (
                <IconButton icon={PanelLeft} label="Show Sidebar" onClick={toggleSidebar} className={floating ? 'material-floating text-label' : undefined} />
            )}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {leading ??
                    (title ? (
                        <h1
                            className={cn(
                                'truncate px-1.5 text-headline font-semibold text-label transition-opacity duration-150',
                                largeTitleHidden ? 'opacity-100' : 'opacity-0',
                            )}
                            aria-hidden={!largeTitleHidden || undefined}
                        >
                            {title}
                        </h1>
                    ) : null)}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {actions}
                <AccountMenu floating={floating} />
            </div>
        </header>
    );
}

/** Large title block at the top of a scrolling screen. */
export function PageHeader({
    title,
    subtitle,
    icon,
    actions,
    className,
}: {
    title: ReactNode;
    subtitle?: ReactNode;
    icon?: ReactNode;
    actions?: ReactNode;
    className?: string;
}) {
    const setLargeTitleEl = useLargeTitleRef();
    return (
        <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 pt-4 pb-6', className)}>
            {icon}
            <div className="min-w-0 flex-1">
                <h1 ref={setLargeTitleEl} className="text-title1 font-bold tracking-[-0.01em] text-label [overflow-wrap:anywhere]">
                    {title}
                </h1>
                {subtitle && <div className="mt-1 text-body text-label-2">{subtitle}</div>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
    );
}

/** Centered readable column for list screens. */
export function Content({ children, className, width = 'regular' }: { children: ReactNode; className?: string; width?: 'regular' | 'narrow' }) {
    return (
        <div className={cn('mx-auto w-full px-4 pb-16 sm:px-8', width === 'narrow' ? 'max-w-[640px]' : 'max-w-[1040px]', className)}>
            {children}
        </div>
    );
}
