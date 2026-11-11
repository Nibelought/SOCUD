"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowDownUp, FilePlus2, FileText, FolderX, MoreHorizontal, PenLine, Search, Settings, Users } from 'lucide-react';
import { fetchSpace, keys } from '@/lib/queries';
import { loadErrorTitle } from '@/lib/api/result';
import { fullDate, plural, relativeTime } from '@/lib/format';
import { useResource } from '@/hooks/useResource';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { EmptyState, SkeletonRows, SpaceIcon } from '@/components/ui/Bits';
import { Notice } from '@/components/ui/Feedback';
import { Menu } from '@/components/ui/Menu';
import { Content, Page, PageHeader, Toolbar } from '@/components/shell/Page';
import { useApp } from '@/components/shell/AppContext';
import { SettingsSheet, type SettingsTab } from '@/components/sharing/SettingsSheet';

type Sort = 'updated' | 'title';

export default function SpacePage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { openNewDocument, reloadSpaces } = useApp();
    const space = useResource(keys.space(id), () => fetchSpace(id));
    const [filter, setFilter] = useState('');
    const [sort, setSort] = useState<Sort>('updated');
    const [settings, setSettings] = useState<SettingsTab | null>(null);
    useDocumentTitle(space.data?.name);

    const documents = useMemo(() => {
        const all = space.data?.documents ?? [];
        const q = filter.trim().toLocaleLowerCase();
        const matched = q ? all.filter((d) => d.title.toLocaleLowerCase().includes(q)) : all;
        return [...matched].sort((a, b) =>
            sort === 'title' ? a.title.localeCompare(b.title) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
    }, [space.data, filter, sort]);

    if (space.error && !space.data) {
        return (
            <Page toolbar={<Toolbar />}>
                <EmptyState
                    icon={FolderX}
                    title={loadErrorTitle(space.error, 'space')}
                    action={
                        <>
                            <Button onClick={space.reload}>Try Again</Button>
                            <ButtonLink href="/dashboard" variant="primary">
                                Go Home
                            </ButtonLink>
                        </>
                    }
                >
                    Ask an owner of the space to share it with you, or pick another space in the sidebar.
                </EmptyState>
            </Page>
        );
    }

    const data = space.data;
    const total = data?.documents.length ?? 0;

    return (
        <Page
            toolbar={
                <Toolbar
                    title={data?.name}
                    actions={
                        data && (
                            <>
                                <IconButton icon={Users} label="Share" onClick={() => setSettings('people')} />
                                <Menu
                                    label="Space actions"
                                    align="end"
                                    items={[
                                        { label: 'Space Settings…', icon: Settings, onSelect: () => setSettings('general') },
                                        { label: 'Share…', icon: Users, onSelect: () => setSettings('people') },
                                    ]}
                                    trigger={(props) => <IconButton {...props} icon={MoreHorizontal} label="More" />}
                                />
                                <Button variant="primary" icon={FilePlus2} onClick={() => openNewDocument(id)}>
                                    New Document
                                </Button>
                            </>
                        )
                    }
                />
            }
        >
            <Content>
                {!data ? (
                    <div className="pt-4">
                        <div className="animate-shimmer mb-8 h-14 w-1/2 rounded-tile bg-fill" />
                        <SkeletonRows count={5} />
                    </div>
                ) : (
                    <>
                        <PageHeader
                            icon={<SpaceIcon id={data.id} name={data.name} size="lg" />}
                            title={data.name}
                            subtitle={
                                <>
                                    {data.description && <p className="mb-1 max-w-[68ch] text-body text-label">{data.description}</p>}
                                    <p>{plural(total, 'document')}</p>
                                </>
                            }
                        />

                        {data.isArchived && (
                            <Notice
                                tone="warning"
                                title="This space is archived"
                                className="mb-6"
                                action={<Button size="sm" onClick={() => setSettings('general')}>Restore…</Button>}
                            >
                                It’s hidden from its members until an owner restores it.
                            </Notice>
                        )}

                        {total === 0 ? (
                            <EmptyState
                                icon={FileText}
                                title="No documents yet"
                                className="rounded-tile bg-grouped"
                                action={
                                    <Button variant="primary" icon={FilePlus2} onClick={() => openNewDocument(id)}>
                                        New Document
                                    </Button>
                                }
                            >
                                Write the first one. Everyone with access to {data.name} can read it once you publish it.
                            </EmptyState>
                        ) : (
                            <>
                                <div className="mb-2 flex items-center gap-2">
                                    <div className="relative max-w-xs flex-1">
                                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-label-3" aria-hidden />
                                        <input
                                            type="search"
                                            aria-label={`Filter documents in ${data.name}`}
                                            placeholder="Filter by title"
                                            value={filter}
                                            onChange={(e) => setFilter(e.target.value)}
                                            className="h-8 w-full rounded-field bg-fill pl-8 pr-3 text-body text-label outline-none focus:bg-window focus:shadow-[inset_0_0_0_1px_var(--c-accent)]"
                                        />
                                    </div>
                                    <div className="flex-1" />
                                    <Menu
                                        label="Sort documents"
                                        align="end"
                                        items={[
                                            { heading: 'Sort By' },
                                            { label: 'Last Updated', checked: sort === 'updated', onSelect: () => setSort('updated') },
                                            { label: 'Title', checked: sort === 'title', onSelect: () => setSort('title') },
                                        ]}
                                        trigger={(props) => (
                                            <Button {...props} size="sm" variant="plain" icon={ArrowDownUp}>
                                                {sort === 'updated' ? 'Last Updated' : 'Title'}
                                            </Button>
                                        )}
                                    />
                                </div>

                                {space.loading && !data ? (
                                    <SkeletonRows />
                                ) : documents.length === 0 ? (
                                    <p className="py-10 text-center text-body text-label-2">No titles contain “{filter.trim()}”.</p>
                                ) : (
                                    <ul className="divide-y divide-separator border-y border-separator">
                                        {documents.map((doc) => (
                                            <li key={doc.id} className="group relative">
                                                <Link
                                                    href={`/document/${doc.id}/view`}
                                                    className="-mx-3 flex h-12 items-center gap-3 rounded-field px-3 pr-14 hover:bg-hover"
                                                >
                                                    <FileText className="size-[18px] shrink-0 text-label-2" strokeWidth={1.7} aria-hidden />
                                                    <span className="min-w-0 flex-1 truncate text-body font-medium text-label">{doc.title || 'Untitled'}</span>
                                                    <time dateTime={doc.updatedAt} title={fullDate(doc.updatedAt)} className="shrink-0 text-footnote text-label-2">
                                                        {relativeTime(doc.updatedAt)}
                                                    </time>
                                                </Link>
                                                <IconButton
                                                    icon={PenLine}
                                                    size="sm"
                                                    label={`Edit ${doc.title || 'Untitled'}`}
                                                    onClick={() => router.push(`/document/${doc.id}`)}
                                                    className="absolute top-1/2 -right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </>
                )}
            </Content>

            <SettingsSheet
                open={settings !== null}
                initialTab={settings ?? 'general'}
                onClose={() => setSettings(null)}
                entityType="space"
                entityId={id}
                onRemoved={() => {
                    reloadSpaces();
                    router.push('/dashboard');
                }}
                onRestored={space.reload}
            />
        </Page>
    );
}
