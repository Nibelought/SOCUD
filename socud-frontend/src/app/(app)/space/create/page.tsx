"use client";

import { useRouter } from 'next/navigation';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Content, Page, PageHeader, Toolbar } from '@/components/shell/Page';
import { NewSpaceFields, useNewSpaceForm } from '@/components/spaces/NewSpaceSheet';

/** Full-screen version of the New Space sheet, for direct links. */
export default function CreateSpacePage() {
    const router = useRouter();
    const form = useNewSpaceForm((space) => router.push(`/space/${space.id}`));
    return (
        <Page toolbar={<Toolbar title="New Space" />}>
            <Content width="narrow">
                <PageHeader title="New Space" subtitle="A space groups documents for a team, project or topic. You become its owner." />
                <form onSubmit={form.submit} noValidate className="rounded-tile bg-grouped p-5">
                    <NewSpaceFields form={form} />
                    <div className="mt-6 flex justify-end gap-2">
                        <ButtonLink href="/dashboard">Cancel</ButtonLink>
                        <Button type="submit" variant="primary" loading={form.submitting}>
                            Create Space
                        </Button>
                    </div>
                </form>
            </Content>
        </Page>
    );
}
