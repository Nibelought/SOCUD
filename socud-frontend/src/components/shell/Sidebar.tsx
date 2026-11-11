"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronRight, FileText, House, PanelLeft, Plus, Search, Waypoints } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchSpace, keys } from '@/lib/queries';
import { useResource } from '@/hooks/useResource';
import { IconButton } from '@/components/ui/Button';
import { Kbd, SpaceIcon } from '@/components/ui/Bits';
import { AppMark } from './AppMark';
import { useApp, type SpaceSummary } from './AppContext';
import { useShell } from './AppShell';

/**
 * Sidebar: the app's places (Home, Graph) and the person's spaces. Two levels at most: a space
 * discloses its documents. Nothing critical sits at the bottom. Icons use the accent color, spaces
 * their own color.
 */
export function Sidebar() {
    const { spaces, spacesLoading, spacesError, reloadSpaces, openSearch, openNewSpace } = useApp();
    const { toggleSidebar } = useShell();
    const pathname = usePathname();

    return (
        <nav aria-label="Sidebar" className="scrollbar-thin flex h-full flex-col overflow-y-auto px-2.5 pb-4">
            <div className="flex h-[52px] shrink-0 items-center justify-between pl-1.5">
                <Link href="/dashboard" className="flex items-center gap-2 rounded-control px-1 py-1 text-headline font-semibold text-label">
                    <AppMark className="size-6" />
                    SOCUD
                </Link>
                <IconButton icon={PanelLeft} label="Hide Sidebar" shortcut="⌃⌘S" onClick={toggleSidebar} />
            </div>

            <button
                type="button"
                onClick={openSearch}
                className="mb-3 flex h-8 w-full items-center gap-2 rounded-field bg-fill px-2.5 text-body text-label-2 transition-colors hover:bg-fill-strong"
            >
                <Search className="size-4" strokeWidth={1.9} aria-hidden />
                <span className="flex-1 text-left">Search</span>
                <Kbd>⌘K</Kbd>
            </button>

            <ul className="flex flex-col gap-px">
                <NavRow href="/dashboard" icon={House} label="Home" active={pathname === '/dashboard'} />
                <NavRow href="/graph" icon={Waypoints} label="Graph" active={pathname === '/graph'} />
            </ul>

            <div className="mt-5 mb-1 flex h-7 items-center justify-between pl-2.5">
                <h2 className="text-footnote font-semibold text-label-2">Spaces</h2>
                <IconButton icon={Plus} size="sm" label="New Space" onClick={openNewSpace} />
            </div>

            {spacesError && !spaces ? (
                <div className="px-2.5 py-1 text-footnote text-label-2">
                    Couldn’t load spaces.{' '}
                    <button type="button" onClick={reloadSpaces} className="font-medium text-accent hover:underline">
                        Try Again
                    </button>
                </div>
            ) : !spaces && spacesLoading ? (
                <div className="flex flex-col gap-2 px-2.5 py-1" aria-hidden>
                    {[60, 45, 70].map((w) => (
                        <div key={w} className="flex items-center gap-2">
                            <div className="animate-shimmer size-4 rounded-[4px] bg-fill" />
                            <div className="animate-shimmer h-2.5 rounded bg-fill" style={{ width: `${w}%` }} />
                        </div>
                    ))}
                </div>
            ) : spaces && spaces.length === 0 ? (
                <button
                    type="button"
                    onClick={openNewSpace}
                    className="mx-1 rounded-field border border-dashed border-separator-strong px-3 py-3 text-left text-footnote text-label-2 hover:bg-hover"
                >
                    <span className="block font-medium text-label">Create your first space</span>
                    A space holds a team’s or a topic’s documents.
                </button>
            ) : (
                <ul className="flex flex-col gap-px">
                    {spaces?.map((space) => (
                        <SpaceRow key={space.id} space={space} pathname={pathname} />
                    ))}
                </ul>
            )}
        </nav>
    );
}

const rowClasses = (active: boolean) =>
    cn(
        'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-2.5 text-body transition-colors',
        active ? 'bg-selection font-medium text-label' : 'text-label hover:bg-hover',
    );

function NavRow({ href, icon: Icon, label, active }: { href: string; icon: typeof House; label: string; active: boolean }) {
    return (
        <li className="flex">
            <Link href={href} aria-current={active ? 'page' : undefined} className={rowClasses(active)}>
                <Icon className="size-[18px] shrink-0 text-accent" strokeWidth={1.8} aria-hidden />
                <span className="truncate">{label}</span>
            </Link>
        </li>
    );
}

const DOCS_SHOWN = 30;

function SpaceRow({ space, pathname }: { space: SpaceSummary; pathname: string }) {
    const href = `/space/${space.id}`;
    const active = pathname === href;
    const [expanded, setExpanded] = useState(false);
    const detail = useResource(expanded ? keys.space(space.id) : null, () => fetchSpace(space.id));
    const docs = detail.data?.documents ?? [];
    const count = space._count?.documents ?? 0;

    return (
        <li>
            <div className="group/row relative flex items-center">
                <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${space.name}`}
                    onClick={() => setExpanded((e) => !e)}
                    className="absolute left-0 z-10 flex h-8 w-5 items-center justify-center rounded text-label-3 hover:text-label"
                >
                    <ChevronRight
                        className={cn('size-3.5 transition-transform duration-150 motion-reduce:transition-none', expanded && 'rotate-90')}
                        strokeWidth={2.2}
                        aria-hidden
                    />
                </button>
                <Link href={href} aria-current={active ? 'page' : undefined} className={cn(rowClasses(active), 'pl-5')}>
                    <SpaceIcon id={space.id} name={space.name} size="xs" />
                    <span className="flex-1 truncate">{space.name}</span>
                    {count > 0 && <span className="text-footnote tabular-nums text-label-2">{count}</span>}
                </Link>
            </div>
            {expanded && (
                <ul className="mb-1 flex flex-col gap-px pl-5">
                    {detail.loading && !detail.data ? (
                        <li className="px-2.5 py-1.5 text-footnote text-label-2">Loading…</li>
                    ) : docs.length === 0 ? (
                        <li className="px-2.5 py-1.5 text-footnote text-label-2">No documents yet</li>
                    ) : (
                        <>
                            {docs.slice(0, DOCS_SHOWN).map((doc) => {
                                const docHref = `/document/${doc.id}/view`;
                                const docActive = pathname === docHref || pathname === `/document/${doc.id}`;
                                return (
                                    <li key={doc.id} className="flex">
                                        <Link href={docHref} aria-current={docActive ? 'page' : undefined} className={cn(rowClasses(docActive), 'h-7')}>
                                            <FileText className="size-4 shrink-0 text-label-2" strokeWidth={1.7} aria-hidden />
                                            <span className="truncate text-footnote">{doc.title || 'Untitled'}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                            {docs.length > DOCS_SHOWN && (
                                <li>
                                    <Link href={href} className="block px-2.5 py-1 text-footnote font-medium text-accent hover:underline">
                                        Show All {docs.length}
                                    </Link>
                                </li>
                            )}
                        </>
                    )}
                </ul>
            )}
        </li>
    );
}
