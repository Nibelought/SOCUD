"use client";

import Link from 'next/link';
import { FilePlus2, FileText, FolderPlus, Plus } from 'lucide-react';
import { fetchRecent, keys } from '@/lib/queries';
import { fullDate, plural, relativeTime } from '@/lib/format';
import { spaceTint } from '@/lib/spaceColor';
import { useResource } from '@/hooks/useResource';
import { Button } from '@/components/ui/Button';
import { EmptyState, SectionHeader, SkeletonRows, SpaceIcon } from '@/components/ui/Bits';
import { Notice } from '@/components/ui/Feedback';
import { Content, Page, PageHeader, Toolbar } from '@/components/shell/Page';
import { useApp, type SpaceSummary } from '@/components/shell/AppContext';
import EmbeddingModelBanner from '@/components/admin/EmbeddingModelBanner';

/** Home: pick up where you left off (recent documents), then your spaces. */
export default function HomePage() {
    const { user, spaces, spacesError, reloadSpaces, openNewDocument, openNewSpace } = useApp();
    const recent = useResource(keys.recent, fetchRecent);
    const spaceIdByName = new Map(spaces?.map((s) => [s.name, s.id]) ?? []);

    const firstRun = spaces !== undefined && spaces.length === 0;

    return (
        <Page
            toolbar={
                <Toolbar
                    title="Home"
                    actions={
                        !firstRun && (
                            <Button variant="primary" icon={Plus} onClick={() => openNewDocument()}>
                                New Document
                            </Button>
                        )
                    }
                />
            }
        >
            <Content>
                <PageHeader title="Home" subtitle={user ? `Signed in as ${user.email}` : undefined} />

                <EmbeddingModelBanner />

                {firstRun ? (
                    <EmptyState
                        icon={FolderPlus}
                        title="Start with a space"
                        className="mt-6 rounded-tile bg-grouped"
                        action={
                            <Button variant="primary" icon={FolderPlus} onClick={openNewSpace}>
                                New Space
                            </Button>
                        }
                    >
                        Spaces hold the documents of a team, a project or a topic. Create one, then write your first document in it.
                    </EmptyState>
                ) : (
                    <>
                        <section aria-labelledby="recent-heading" className="mt-2">
                            <SectionHeader id="recent-heading" title="Recently updated" />
                            {recent.error && !recent.data ? (
                                <Notice tone="error" title="Couldn’t load recent documents" action={<Button size="sm" onClick={recent.reload}>Try Again</Button>} />
                            ) : !recent.data ? (
                                <SkeletonRows count={3} />
                            ) : recent.data.length === 0 ? (
                                <div className="flex items-center justify-between gap-4 rounded-tile bg-grouped px-4 py-4">
                                    <p className="text-body text-label-2">Documents you and your team update will show up here.</p>
                                    <Button icon={FilePlus2} onClick={() => openNewDocument()}>
                                        New Document
                                    </Button>
                                </div>
                            ) : (
                                <ul className="divide-y divide-separator border-y border-separator">
                                    {recent.data.map((doc) => {
                                        const spaceId = spaceIdByName.get(doc.space?.name ?? '');
                                        return (
                                            <li key={doc.id}>
                                                <Link
                                                    href={`/document/${doc.id}/view`}
                                                    className="-mx-3 flex h-12 items-center gap-3 rounded-field px-3 hover:bg-hover"
                                                >
                                                    <FileText className="size-[18px] shrink-0 text-label-2" strokeWidth={1.7} aria-hidden />
                                                    <span className="min-w-0 flex-1 truncate text-body font-medium text-label">{doc.title || 'Untitled'}</span>
                                                    {doc.space?.name && (
                                                        <span className="hidden min-w-0 max-w-[30%] items-center gap-1.5 text-footnote text-label-2 sm:flex">
                                                            <span aria-hidden style={spaceId ? spaceTint(spaceId) : undefined} className="size-2 shrink-0 rounded-full bg-tint" />
                                                            <span className="truncate">{doc.space.name}</span>
                                                        </span>
                                                    )}
                                                    <time dateTime={doc.updatedAt} title={fullDate(doc.updatedAt)} className="w-24 shrink-0 text-right text-footnote text-label-2">
                                                        {relativeTime(doc.updatedAt)}
                                                    </time>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>

                        <section aria-labelledby="spaces-heading" className="mt-10">
                            <SectionHeader
                                id="spaces-heading"
                                title="Spaces"
                                action={
                                    <Button variant="plain" size="sm" icon={Plus} onClick={openNewSpace}>
                                        New Space
                                    </Button>
                                }
                            />
                            {spacesError && !spaces ? (
                                <Notice tone="error" title="Couldn’t load your spaces" action={<Button size="sm" onClick={reloadSpaces}>Try Again</Button>} />
                            ) : !spaces ? (
                                <SkeletonRows count={2} />
                            ) : (
                                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {spaces.map((space) => (
                                        <li key={space.id}>
                                            <SpaceTile space={space} />
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </>
                )}
            </Content>
        </Page>
    );
}

function SpaceTile({ space }: { space: SpaceSummary }) {
    const count = space._count?.documents ?? 0;
    return (
        <Link
            href={`/space/${space.id}`}
            className="flex h-full items-start gap-3 rounded-tile bg-window p-4 shadow-tile transition-colors hover:bg-hover"
        >
            <SpaceIcon id={space.id} name={space.name} size="md" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-headline font-semibold text-label">{space.name}</p>
                <p className="mt-0.5 line-clamp-2 text-footnote text-label-2">{space.description || plural(count, 'document')}</p>
                {space.description && <p className="mt-1.5 text-footnote text-label-2">{plural(count, 'document')}</p>}
            </div>
        </Link>
    );
}
