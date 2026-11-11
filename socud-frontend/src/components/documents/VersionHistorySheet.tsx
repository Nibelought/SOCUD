"use client";

import { useState } from 'react';
import { History } from 'lucide-react';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/result';
import { cn } from '@/lib/cn';
import { fullDate, relativeTime } from '@/lib/format';
import { keys } from '@/lib/queries';
import { useResource } from '@/hooks/useResource';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Bits';
import { Notice } from '@/components/ui/Feedback';
import { Sheet } from '@/components/ui/Sheet';
import { LoadingRegion } from '@/components/ui/Spinner';
import { PublishedContent } from './DocumentParts';

/** Every published version of a document, newest first, with a read-only preview of each. */
export function VersionHistorySheet({ open, onClose, documentId }: { open: boolean; onClose: () => void; documentId: string }) {
    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Version History"
            description="Each Publish saves a version. Readers see the latest one."
            size="lg"
            footer={
                <Button variant="primary" onClick={onClose}>
                    Done
                </Button>
            }
        >
            {open && <Versions documentId={documentId} />}
        </Sheet>
    );
}

function Versions({ documentId }: { documentId: string }) {
    const list = useResource(keys.versions(documentId), async () =>
        unwrap(await api.GET('/document/{id}/versions', { params: { path: { id: documentId } } }), 'Couldn’t load the version history'),
    );
    const [selected, setSelected] = useState<number | null>(null);
    const versions = list.data ?? [];
    const current = selected ?? versions[0]?.version ?? null;

    const detail = useResource(current !== null ? `${keys.versions(documentId)}:${current}` : null, async () =>
        unwrap(
            await api.GET('/document/{id}/versions/{version}', { params: { path: { id: documentId, version: current as number } } }),
            'Couldn’t load this version',
        ),
    );

    if (list.error && !list.data) return <Notice tone="error" title="Couldn’t load the version history" />;
    if (!list.data) return <LoadingRegion />;
    if (versions.length === 0) {
        return (
            <EmptyState icon={History} title="No versions yet" className="py-10">
                Publish the document from the editor to save its first version.
            </EmptyState>
        );
    }

    return (
        <div className="flex min-h-[50vh] flex-col gap-4 md:flex-row">
            <ul aria-label="Versions" className="flex shrink-0 gap-1 overflow-x-auto md:w-[200px] md:flex-col md:overflow-visible">
                {versions.map((v, i) => (
                    <li key={v.version} className="shrink-0">
                        <button
                            type="button"
                            aria-current={v.version === current || undefined}
                            onClick={() => setSelected(v.version)}
                            className={cn(
                                'w-full rounded-field px-3 py-2 text-left transition-colors',
                                v.version === current ? 'bg-selection' : 'hover:bg-hover',
                            )}
                        >
                            <span className="block text-body font-medium text-label">
                                Version {v.version}
                                {i === 0 && <span className="font-normal text-label-2"> (latest)</span>}
                            </span>
                            <span className="block text-footnote text-label-2" title={fullDate(v.createdAt)}>
                                {relativeTime(v.createdAt)}
                            </span>
                            <span className="block truncate text-footnote text-label-2">{v.author?.email}</span>
                        </button>
                    </li>
                ))}
            </ul>
            <div className="min-w-0 flex-1 rounded-tile bg-grouped p-5">
                {detail.error ? (
                    <Notice tone="error" title="Couldn’t load this version" />
                ) : !detail.data ? (
                    <LoadingRegion />
                ) : (
                    <article>
                        <h3 className="mb-4 text-title2 font-bold">{detail.data.title}</h3>
                        <PublishedContent html={detail.data.contentHtml} className="text-[16px]" />
                    </article>
                )}
            </div>
        </div>
    );
}
