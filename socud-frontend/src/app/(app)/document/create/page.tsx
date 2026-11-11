"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Bits';
import { LoadingRegion } from '@/components/ui/Spinner';
import { Content, Page, PageHeader, Toolbar } from '@/components/shell/Page';
import { useApp } from '@/components/shell/AppContext';
import { NewDocumentFields, useNewDocumentForm } from '@/components/documents/NewDocumentSheet';

/** Full-screen version of the New Document sheet, for direct links. `?space=<id>` preselects a space. */
export default function CreateDocumentPage() {
    return (
        <Page toolbar={<Toolbar title="New Document" />}>
            <Content width="narrow">
                <PageHeader title="New Document" />
                <Suspense fallback={<LoadingRegion />}>
                    <CreateDocumentForm />
                </Suspense>
            </Content>
        </Page>
    );
}

function CreateDocumentForm() {
    const router = useRouter();
    const params = useSearchParams();
    const { spaces, openNewSpace } = useApp();
    const form = useNewDocumentForm(spaces, params.get('space') ?? undefined, (doc) => router.push(`/document/${doc.id}`));

    if (!spaces) return <LoadingRegion />;
    if (spaces.length === 0) {
        return (
            <EmptyState
                icon={FolderPlus}
                title="Create a space first"
                className="rounded-tile bg-grouped"
                action={
                    <Button variant="primary" onClick={openNewSpace}>
                        New Space
                    </Button>
                }
            >
                Documents live in spaces, so people with access to the space can find them.
            </EmptyState>
        );
    }

    return (
        <form onSubmit={form.submit} noValidate className="rounded-tile bg-grouped p-5">
            <NewDocumentFields form={form} spaces={spaces} />
            <div className="mt-6 flex justify-end gap-2">
                <ButtonLink href="/dashboard">Cancel</ButtonLink>
                <Button type="submit" variant="primary" loading={form.submitting} disabled={!form.spaceId}>
                    Create and Edit
                </Button>
            </div>
        </form>
    );
}
