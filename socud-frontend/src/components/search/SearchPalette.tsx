"use client";

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Search, SearchX } from 'lucide-react';
import { api, type components } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { fetchRecent, keys } from '@/lib/queries';
import { spaceTint } from '@/lib/spaceColor';
import { useResource } from '@/hooks/useResource';
import { Kbd } from '@/components/ui/Bits';
import { Spinner } from '@/components/ui/Spinner';
import { useApp } from '@/components/shell/AppContext';

type SearchResult = components['schemas']['SearchResultDto'];

interface Row {
    id: string;
    title: string;
    spaceName: string;
    detail: string;
    snippet?: string;
}

/**
 * Search, in the manner of Spotlight: one place to find any document, by words or by meaning.
 * Opens with ⌘K or "/", shows recent documents before typing, and is fully keyboard driven
 * (combobox + listbox pattern for screen readers).
 */
export function SearchPalette() {
    const { searchOpen, closeSearch } = useApp();
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (searchOpen && !dialog.open) dialog.showModal();
        else if (!searchOpen && dialog.open) dialog.close();
    }, [searchOpen]);

    return (
        <dialog
            ref={ref}
            aria-label="Search documents"
            onCancel={(e) => {
                e.preventDefault();
                closeSearch();
            }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) closeSearch();
            }}
            className="sheet mx-auto mt-[12vh] mb-auto w-[640px] max-w-[calc(100vw-24px)] overflow-hidden rounded-sheet bg-elevated p-0 text-label shadow-sheet"
        >
            {searchOpen && <SearchBody onClose={closeSearch} />}
        </dialog>
    );
}

function SearchBody({ onClose }: { onClose: () => void }) {
    const router = useRouter();
    const { spaces } = useApp();
    const listId = useId();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [searching, setSearching] = useState(false);
    const [active, setActive] = useState(0);
    const recent = useResource(keys.recent, fetchRecent);
    const requestSeq = useRef(0);

    const trimmed = query.trim();

    useEffect(() => {
        if (!trimmed) {
            setResults(null);
            setSearching(false);
            return;
        }
        setSearching(true);
        const seq = ++requestSeq.current;
        const timer = setTimeout(async () => {
            try {
                const { data, response } = await api.GET('/document/search', { params: { query: { q: trimmed } } });
                if (seq !== requestSeq.current) return;
                setFailed(!response.ok);
                setResults(response.ok && data ? data : []);
            } catch {
                if (seq === requestSeq.current) {
                    setFailed(true);
                    setResults([]);
                }
            } finally {
                if (seq === requestSeq.current) setSearching(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [trimmed]);

    const spaceIdByName = useMemo(() => new Map(spaces?.map((s) => [s.name, s.id]) ?? []), [spaces]);

    const rows: Row[] = useMemo(() => {
        if (!trimmed) {
            return (recent.data ?? []).map((d) => ({
                id: d.id,
                title: d.title,
                spaceName: d.space?.name ?? '',
                detail: relativeTime(d.updatedAt),
            }));
        }
        return (results ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            spaceName: r.space,
            detail: r.type === 'semantic' ? (r.score != null ? `${Math.round(r.score * 100)}% similar` : 'Similar meaning') : 'Contains words',
            snippet: r.snippet,
        }));
    }, [trimmed, results, recent.data]);

    const activeIndex = Math.min(active, Math.max(0, rows.length - 1));

    const open = (row: Row | undefined) => {
        if (!row) return;
        onClose();
        router.push(`/document/${row.id}/view`);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(rows.length - 1, activeIndex + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(0, activeIndex - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            open(rows[activeIndex]);
        }
    };

    useEffect(() => {
        document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, listId]);

    const showEmpty = trimmed && !searching && results !== null && rows.length === 0;

    return (
        <div className="animate-sheet flex max-h-[min(70vh,640px)] flex-col">
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-separator px-4">
                <Search className="size-5 shrink-0 text-label-2" strokeWidth={1.9} aria-hidden />
                <input
                    autoFocus
                    role="combobox"
                    aria-expanded={rows.length > 0}
                    aria-controls={listId}
                    aria-activedescendant={rows.length > 0 ? `${listId}-${activeIndex}` : undefined}
                    aria-autocomplete="list"
                    aria-label="Search documents"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder="Search by words or by meaning"
                    className="h-full min-w-0 flex-1 bg-transparent text-title3 text-label outline-none"
                    spellCheck={false}
                />
                {searching && <Spinner className="size-4" label="Searching" />}
            </div>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
                {!trimmed && rows.length > 0 && <p className="px-2.5 pt-1 pb-1.5 text-footnote font-semibold text-label-2">Recent</p>}
                {failed && <p className="px-3 py-6 text-center text-body text-label-2">Search isn’t available right now. Try again in a moment.</p>}
                {showEmpty && !failed && (
                    <div className="flex flex-col items-center px-6 py-10 text-center">
                        <SearchX className="mb-2 size-8 text-label-3" strokeWidth={1.5} aria-hidden />
                        <p className="text-body font-medium">No documents match “{trimmed}”</p>
                        <p className="mt-1 text-footnote text-label-2">Try other words, or describe what the document is about.</p>
                    </div>
                )}
                <ul id={listId} role="listbox" aria-label={trimmed ? 'Results' : 'Recent documents'}>
                    {rows.map((row, i) => {
                        const spaceId = spaceIdByName.get(row.spaceName);
                        return (
                            <li
                                key={row.id}
                                id={`${listId}-${i}`}
                                role="option"
                                aria-selected={i === activeIndex}
                                onMouseMove={() => setActive(i)}
                                onClick={() => open(row)}
                                className={cn('flex cursor-default gap-3 rounded-field px-2.5 py-2', i === activeIndex ? 'bg-selection' : '')}
                            >
                                <FileText className="mt-0.5 size-[18px] shrink-0 text-label-2" strokeWidth={1.7} aria-hidden />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-2">
                                        <span className="truncate text-body font-medium text-label">{row.title || 'Untitled'}</span>
                                        {row.spaceName && (
                                            <span className="flex shrink-0 items-center gap-1 text-footnote text-label-2">
                                                <span aria-hidden style={spaceId ? spaceTint(spaceId) : undefined} className="size-2 rounded-full bg-tint" />
                                                {row.spaceName}
                                            </span>
                                        )}
                                        <span className="ml-auto shrink-0 pl-2 text-footnote text-label-2">{row.detail}</span>
                                    </div>
                                    {row.snippet && <p className="mt-0.5 line-clamp-2 text-footnote text-label-2">{row.snippet}</p>}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>

            <div className="hidden shrink-0 items-center gap-4 border-t border-separator px-4 py-2 text-caption text-label-2 sm:flex">
                <span className="flex items-center gap-1">
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd> to move
                </span>
                <span className="flex items-center gap-1">
                    <Kbd>↩</Kbd> to open
                </span>
                <span className="flex items-center gap-1">
                    <Kbd>esc</Kbd> to close
                </span>
            </div>
        </div>
    );
}
