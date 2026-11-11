"use client";

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Maximize, Minus, Plus, Waypoints } from 'lucide-react';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/result';
import { graphTruncationNotice } from '@/lib/graphNotice';
import { plural } from '@/lib/format';
import { keys } from '@/lib/queries';
import { spaceTint } from '@/lib/spaceColor';
import { cn } from '@/lib/cn';
import { useResource } from '@/hooks/useResource';
import { useColorScheme } from '@/hooks/useMediaQuery';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Bits';
import { LoadingRegion } from '@/components/ui/Spinner';
import { Page, Toolbar } from '@/components/shell/Page';
import type { GraphControls } from '@/components/graph/GraphVisualizer';

const GraphVisualizer = dynamic(() => import('@/components/graph/GraphVisualizer'), { ssr: false, loading: () => <LoadingRegion label="Drawing the graph" /> });

/** The knowledge graph: every readable document and the links between them, colored by space. */
export default function GraphPage() {
    const router = useRouter();
    const scheme = useColorScheme();
    const controls = useRef<GraphControls>(null);
    const [focusSpace, setFocusSpace] = useState<string | null>(null);
    const graph = useResource(keys.graph, async () => unwrap(await api.GET('/document/graph'), 'Couldn’t load the graph'));
    const data = graph.data;

    const spaces = useMemo(() => {
        const map = new Map<string, { id: string; name: string; count: number }>();
        for (const n of data?.nodes ?? []) {
            const entry = map.get(n.group) ?? { id: n.group, name: n.spaceName, count: 0 };
            entry.count++;
            map.set(n.group, entry);
        }
        return [...map.values()].sort((a, b) => b.count - a.count);
    }, [data]);

    const notice = graphTruncationNotice(data?.truncated, data?.nodes.length ?? 0);
    const glass = 'material-floating rounded-full';

    return (
        <Page
            bleed
            className="bg-window"
            toolbar={
                <Toolbar
                    floating
                    leading={
                        <div className={cn(glass, 'flex h-8 items-center gap-2 px-3.5')}>
                            <h1 className="text-headline font-semibold text-label">Graph</h1>
                            {data && (
                                <span className="hidden text-footnote text-label-2 sm:inline">
                                    {plural(data.nodes.length, 'document')}, {plural(data.links.length, 'link')}
                                </span>
                            )}
                        </div>
                    }
                    actions={
                        data &&
                        data.nodes.length > 0 && (
                            <div className={cn(glass, 'flex items-center p-0.5')} role="group" aria-label="Zoom">
                                <IconButton icon={Minus} size="sm" label="Zoom Out" onClick={() => controls.current?.zoomOut()} className="rounded-full" />
                                <IconButton icon={Maximize} size="sm" label="Fit to Window" onClick={() => controls.current?.fit()} className="rounded-full" />
                                <IconButton icon={Plus} size="sm" label="Zoom In" onClick={() => controls.current?.zoomIn()} className="rounded-full" />
                            </div>
                        )
                    }
                />
            }
        >
            {graph.error && !data ? (
                <EmptyState icon={Waypoints} title="Couldn’t load the graph" className="pt-32" action={<Button onClick={graph.reload}>Try Again</Button>}>
                    Check your connection and try again.
                </EmptyState>
            ) : !data ? (
                <LoadingRegion label="Loading the graph" />
            ) : data.nodes.length === 0 ? (
                <EmptyState
                    icon={Waypoints}
                    title="Nothing to map yet"
                    className="pt-32"
                    action={
                        <ButtonLink href="/dashboard" variant="primary">
                            Go Home
                        </ButtonLink>
                    }
                >
                    Documents appear here once they’re published. Link documents to each other to see how your knowledge connects.
                </EmptyState>
            ) : (
                <>
                    <GraphVisualizer ref={controls} data={data} scheme={scheme} onOpen={(id) => router.push(`/document/${id}/view`)} focusSpace={focusSpace} />

                    {spaces.length > 1 && (
                        <div className="material-floating absolute top-16 right-3 z-10 hidden max-h-[50vh] w-[200px] overflow-y-auto rounded-tile p-1.5 md:block">
                            <p className="px-2 pt-1 pb-1.5 text-caption font-semibold text-label-2">Spaces</p>
                            <ul>
                                {spaces.map((s) => (
                                    <li key={s.id}>
                                        <button
                                            type="button"
                                            aria-pressed={focusSpace === s.id}
                                            onClick={() => setFocusSpace((f) => (f === s.id ? null : s.id))}
                                            className={cn(
                                                'flex h-7 w-full items-center gap-2 rounded-control px-2 text-footnote',
                                                focusSpace === s.id ? 'bg-selection font-medium' : 'hover:bg-hover',
                                            )}
                                        >
                                            <span aria-hidden style={spaceTint(s.id)} className="size-2.5 shrink-0 rounded-full bg-tint" />
                                            <span className="flex-1 truncate text-left text-label">{s.name}</span>
                                            <span className="tabular-nums text-label-2">{s.count}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {notice && (
                        <p role="status" className="material-floating pointer-events-none absolute top-16 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-footnote text-label-2">
                            {notice}
                        </p>
                    )}

                    {/* The same content for screen readers and keyboard users: the canvas can't be navigated. */}
                    <nav aria-label="Documents in the graph" className="sr-only">
                        <ul>
                            {data.nodes.map((n) => (
                                <li key={n.id}>
                                    <Link href={`/document/${n.id}/view`}>
                                        {n.name}, in {n.spaceName}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </>
            )}
        </Page>
    );
}
