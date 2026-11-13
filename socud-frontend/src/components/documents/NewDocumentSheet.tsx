"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderPlus } from 'lucide-react';
import { api, type components } from '@/lib/api/client';
import { unwrap } from '@/lib/api/result';
import { caughtMessage } from '@/lib/api/errors';
import { invalidate } from '@/hooks/useResource';
import { keys } from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/Bits';
import { Notice } from '@/components/ui/Feedback';
import { Sheet } from '@/components/ui/Sheet';
import { LoadingRegion } from '@/components/ui/Spinner';
import { useApp, type SpaceSummary } from '@/components/shell/AppContext';

type DocumentDto = components['schemas']['DocumentDto'];

/** Form state for creating a document; shared by the sheet and the /document/create screen. */
export function useNewDocumentForm(spaces: SpaceSummary[] | undefined, initialSpaceId: string | undefined, onCreated: (doc: DocumentDto) => void) {
    const [title, setTitle] = useState('');
    const [chosenSpaceId, setSpaceId] = useState<string | undefined>(initialSpaceId);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Default to the requested space, else the first one, once spaces are known.
    const spaceId = chosenSpaceId && spaces?.some((s) => s.id === chosenSpaceId) ? chosenSpaceId : spaces?.[0]?.id ?? '';

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!spaceId) return;
        setSubmitting(true);
        setError(null);
        try {
            const doc = unwrap(
                await api.POST('/document', { body: { title: title.trim() || 'Untitled', spaceId } }),
                'Couldn’t create the document',
            );
            invalidate(keys.space(spaceId));
            invalidate(keys.spaces);
            invalidate(keys.recent);
            onCreated(doc);
        } catch (err) {
            setError(caughtMessage(err, 'Couldn’t create the document'));
            setSubmitting(false);
        }
    };

    return { title, setTitle, spaceId, setSpaceId, error, submitting, submit };
}

export function NewDocumentFields({ form, spaces }: { form: ReturnType<typeof useNewDocumentForm>; spaces: SpaceSummary[] }) {
    return (
        <div className="flex flex-col gap-4">
            {form.error && <Notice tone="error" title={form.error} />}
            <TextField
                label="Title"
                value={form.title}
                onChange={(e) => form.setTitle(e.target.value)}
                placeholder="Untitled"
                hint="You can change it later."
                maxLength={255}
                autoFocus
            />
            <SelectField label="Space" value={form.spaceId} onChange={(e) => form.setSpaceId(e.target.value)}>
                {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                        {s.name}
                    </option>
                ))}
            </SelectField>
        </div>
    );
}

export function NewDocumentSheet() {
    const { newDocument, closeNewDocument } = useApp();
    return (
        <Sheet open={newDocument !== null} onClose={closeNewDocument} title="New Document" size="sm" modalOnly>
            {newDocument && <NewDocumentSheetBody initialSpaceId={newDocument.spaceId} onClose={closeNewDocument} />}
        </Sheet>
    );
}

function NewDocumentSheetBody({ initialSpaceId, onClose }: { initialSpaceId?: string; onClose: () => void }) {
    const router = useRouter();
    const { spaces, openNewSpace } = useApp();
    const form = useNewDocumentForm(spaces, initialSpaceId, (doc) => {
        onClose();
        router.push(`/document/${doc.id}`);
    });

    if (!spaces) return <LoadingRegion />;
    if (spaces.length === 0) {
        return (
            <EmptyState
                icon={FolderPlus}
                title="Create a space first"
                className="py-6"
                action={
                    <Button
                        variant="primary"
                        onClick={() => {
                            onClose();
                            openNewSpace();
                        }}
                    >
                        New Space
                    </Button>
                }
            >
                Documents live in spaces, so people with access to the space can find them.
            </EmptyState>
        );
    }

    return (
        <form onSubmit={form.submit} noValidate>
            <NewDocumentFields form={form} spaces={spaces} />
            <div className="-mx-6 mt-6 -mb-5 flex justify-end gap-2 border-t border-separator px-6 py-3.5">
                <Button onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="primary" loading={form.submitting} disabled={!form.spaceId}>
                    Create and Edit
                </Button>
            </div>
        </form>
    );
}
