"use client";

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FileX, History, MoreHorizontal, PenLine, Settings, Users } from 'lucide-react';
import { fetchDocument, keys } from '@/lib/queries';
import { loadErrorTitle } from '@/lib/api/result';
import { fullDate, relativeTime } from '@/lib/format';
import { useResource } from '@/hooks/useResource';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Bits';
import { Menu } from '@/components/ui/Menu';
import { Page, Toolbar, useLargeTitleHidden, useLargeTitleRef } from '@/components/shell/Page';
import { Breadcrumb, PublishedContent } from '@/components/documents/DocumentParts';
import { VersionHistorySheet } from '@/components/documents/VersionHistorySheet';
import { SettingsSheet, type SettingsTab } from '@/components/sharing/SettingsSheet';

/** Reading view: the latest published version, set for reading. */
export default function DocumentViewPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const doc = useResource(keys.document(id), () => fetchDocument(id));
    const [settings, setSettings] = useState<SettingsTab | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    useDocumentTitle(doc.data ? doc.data.title || 'Untitled' : undefined);

    if (doc.error && !doc.data) {
        return (
            <Page toolbar={<Toolbar />}>
                <EmptyState
                    icon={FileX}
                    title={loadErrorTitle(doc.error, 'document')}
                    action={
                        <>
                            <Button onClick={doc.reload}>Try Again</Button>
                            <ButtonLink href="/dashboard" variant="primary">
                                Go Home
                            </ButtonLink>
                        </>
                    }
                >
                    If someone shared it with you, ask them to check your access.
                </EmptyState>
            </Page>
        );
    }

    const data = doc.data;
    const hasContent = !!data?.contentHtml?.trim();

    return (
        <Page
            toolbar={
                <Toolbar
                    leading={data && <ViewBreadcrumb spaceId={data.spaceId} spaceName={data.space?.name} title={data.title || 'Untitled'} />}
                    actions={
                        data && (
                            <>
                                <IconButton icon={History} label="Version History" onClick={() => setHistoryOpen(true)} />
                                <IconButton icon={Users} label="Share" onClick={() => setSettings('people')} />
                                <Menu
                                    label="Document actions"
                                    align="end"
                                    items={[
                                        { label: 'Version History…', icon: History, onSelect: () => setHistoryOpen(true) },
                                        { label: 'Share…', icon: Users, onSelect: () => setSettings('people') },
                                        { label: 'Document Settings…', icon: Settings, onSelect: () => setSettings('general') },
                                    ]}
                                    trigger={(props) => <IconButton {...props} icon={MoreHorizontal} label="More" />}
                                />
                                <ButtonLink href={`/document/${id}`} variant="primary" icon={PenLine}>
                                    Edit
                                </ButtonLink>
                            </>
                        )
                    }
                />
            }
        >
            <article className="mx-auto w-full max-w-[740px] px-5 pt-8 pb-24 sm:px-10">
                {!data ? (
                    <div aria-hidden className="flex flex-col gap-4">
                        <div className="animate-shimmer h-10 w-2/3 rounded-tile bg-fill" />
                        <div className="animate-shimmer h-3 w-1/4 rounded bg-fill" />
                        {[92, 85, 96, 70, 88].map((w) => (
                            <div key={w} className="animate-shimmer h-3.5 rounded bg-fill" style={{ width: `${w}%` }} />
                        ))}
                    </div>
                ) : (
                    <>
                        <header className="mb-8">
                            <DocumentTitle>{data.title || 'Untitled'}</DocumentTitle>
                            <p className="mt-2 text-footnote text-label-2">
                                Updated <time dateTime={data.updatedAt} title={fullDate(data.updatedAt)}>{relativeTime(data.updatedAt).toLowerCase()}</time>
                                {data.space?.name && <> in {data.space.name}</>}
                            </p>
                        </header>
                        {hasContent ? (
                            <PublishedContent html={data.contentHtml ?? ''} />
                        ) : (
                            <EmptyState
                                icon={PenLine}
                                title="Nothing published yet"
                                className="rounded-tile bg-grouped"
                                action={
                                    <ButtonLink href={`/document/${id}`} variant="primary" icon={PenLine}>
                                        Open Editor
                                    </ButtonLink>
                                }
                            >
                                Readers see a document once it’s published. Write it in the editor, then choose Publish.
                            </EmptyState>
                        )}
                    </>
                )}
            </article>

            <VersionHistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} documentId={id} />
            <SettingsSheet
                open={settings !== null}
                initialTab={settings ?? 'general'}
                onClose={() => setSettings(null)}
                entityType="document"
                entityId={id}
                spaceId={data?.spaceId}
                onRemoved={() => router.push(data?.spaceId ? `/space/${data.spaceId}` : '/dashboard')}
            />
        </Page>
    );
}

/** The path in the toolbar gains the title once the large title scrolls away. */
function ViewBreadcrumb({ spaceId, spaceName, title }: { spaceId: string; spaceName?: string; title: string }) {
    const hidden = useLargeTitleHidden();
    return <Breadcrumb spaceId={spaceId} spaceName={spaceName} title={hidden ? title : undefined} />;
}

function DocumentTitle({ children }: { children: React.ReactNode }) {
    const ref = useLargeTitleRef();
    return (
        <h1 ref={ref} className="text-display font-bold tracking-[-0.02em] text-label [overflow-wrap:anywhere]">
            {children}
        </h1>
    );
}
