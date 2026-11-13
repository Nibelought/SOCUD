"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type components } from '@/lib/api/client';
import { unwrap } from '@/lib/api/result';
import { caughtMessage } from '@/lib/api/errors';
import { invalidate } from '@/hooks/useResource';
import { keys } from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { TextArea, TextField } from '@/components/ui/Field';
import { Notice, useFeedback } from '@/components/ui/Feedback';
import { Sheet } from '@/components/ui/Sheet';
import { useApp } from '@/components/shell/AppContext';

type Space = components['schemas']['SpaceDto'];

const MIN_NAME = 3;

/** Form state for creating a space; shared by the sheet and the /space/create screen. */
export function useNewSpaceForm(onCreated: (space: Space) => void) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const { toast } = useFeedback();

    const trimmed = name.trim();
    const nameError = touched && trimmed.length < MIN_NAME ? `Use at least ${MIN_NAME} characters.` : null;

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setTouched(true);
        if (trimmed.length < MIN_NAME) return;
        setSubmitting(true);
        setError(null);
        try {
            const space = unwrap(
                await api.POST('/space', { body: { name: trimmed, description: description.trim() || undefined } }),
                'Couldn’t create the space',
            );
            invalidate(keys.spaces);
            toast({ title: `Created “${space.name}”` });
            onCreated(space);
        } catch (err) {
            setError(caughtMessage(err, 'Couldn’t create the space'));
        } finally {
            setSubmitting(false);
        }
    };

    return { name, setName, description, setDescription, nameError, error, submitting, submit, onNameBlur: () => setTouched(true) };
}

export function NewSpaceFields({ form }: { form: ReturnType<typeof useNewSpaceForm> }) {
    return (
        <div className="flex flex-col gap-4">
            {form.error && <Notice tone="error" title={form.error} />}
            <TextField
                label="Name"
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                onBlur={form.onNameBlur}
                error={form.nameError}
                placeholder="Research Notes"
                maxLength={255}
                autoFocus
                required
            />
            <TextArea
                label="Description"
                hint="Optional. Tells people what belongs here."
                value={form.description}
                onChange={(e) => form.setDescription(e.target.value)}
                rows={3}
                maxLength={2000}
            />
        </div>
    );
}

export function NewSpaceSheet() {
    const { newSpaceOpen, closeNewSpace } = useApp();
    const router = useRouter();
    return (
        <Sheet
            open={newSpaceOpen}
            onClose={closeNewSpace}
            title="New Space"
            description="A space groups documents for a team, project or topic. You become its owner."
            modalOnly
        >
            {newSpaceOpen && <NewSpaceSheetBody onClose={closeNewSpace} onCreated={(id) => router.push(`/space/${id}`)} />}
        </Sheet>
    );
}

function NewSpaceSheetBody({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
    const form = useNewSpaceForm((space) => {
        onClose();
        onCreated(space.id);
    });
    return (
        <form onSubmit={form.submit} noValidate>
            <NewSpaceFields form={form} />
            <div className="-mx-6 mt-6 -mb-5 flex justify-end gap-2 border-t border-separator px-6 py-3.5">
                <Button onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="primary" loading={form.submitting}>
                    Create Space
                </Button>
            </div>
        </form>
    );
}
