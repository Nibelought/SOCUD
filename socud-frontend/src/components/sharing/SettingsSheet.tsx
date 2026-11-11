"use client";

import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Search, Trash2, UserPlus, X } from 'lucide-react';
import { api, type components } from '@/lib/api/client';
import { ensureOk } from '@/lib/api/result';
import { caughtMessage } from '@/lib/api/errors';
import { restoreErrorMessage } from '@/lib/restore';
import { cn } from '@/lib/cn';
import { invalidate } from '@/hooks/useResource';
import { keys } from '@/lib/queries';
import { Button } from '@/components/ui/Button';
import { Select, TextArea, TextField } from '@/components/ui/Field';
import { Avatar, SegmentedControl } from '@/components/ui/Bits';
import { Notice, useFeedback } from '@/components/ui/Feedback';
import { Sheet } from '@/components/ui/Sheet';
import { LoadingRegion, Spinner } from '@/components/ui/Spinner';
import { useApp } from '@/components/shell/AppContext';

type Role = components['schemas']['Role'];
type UserSummary = components['schemas']['UserSummaryDto'];

interface Member {
    userId: string;
    role: Role;
    user: UserSummary;
    /** Documents only: access granted on the document itself, or inherited from its space. */
    source?: 'direct' | 'inherited';
}

export type SettingsTab = 'general' | 'people';
export type EntityType = 'space' | 'document';

interface SettingsSheetProps {
    open: boolean;
    onClose: () => void;
    entityType: EntityType;
    entityId: string;
    /** Space of a document, to refresh its list after changes. */
    spaceId?: string;
    initialTab?: SettingsTab;
    /** Called after the entity was archived or deleted (navigate away). */
    onRemoved: (how: 'archived' | 'deleted') => void;
    /** Called after the space was restored from the archive. */
    onRestored?: () => void;
}

const ROLE_LABELS: Record<Role, string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' };
const ROLE_HELP: Record<Role, string> = {
    OWNER: 'Can edit, share, archive and delete',
    EDITOR: 'Can edit and publish',
    VIEWER: 'Can read',
};

/**
 * Settings for a space or a document: its name (and a space's description), who has access, and
 * archive / delete. Space and document endpoints have the same shape; the typed client needs literal
 * paths, so each call branches on the entity type.
 */
export function SettingsSheet(props: SettingsSheetProps) {
    const noun = props.entityType === 'space' ? 'Space' : 'Document';
    return (
        <Sheet open={props.open} onClose={props.onClose} title={`${noun} Settings`} size="md">
            {props.open && <SettingsBody {...props} />}
        </Sheet>
    );
}

function SettingsBody({ onClose, entityType, entityId, spaceId, initialTab = 'general', onRemoved, onRestored }: SettingsSheetProps) {
    const isSpace = entityType === 'space';
    const noun = isSpace ? 'space' : 'document';
    const path = { params: { path: { id: entityId } } };
    const { user, reloadSpaces } = useApp();
    const { toast, confirm } = useFeedback();

    const [tab, setTab] = useState<SettingsTab>(initialTab);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saved, setSaved] = useState({ title: '', description: '' });
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [isArchived, setIsArchived] = useState(false);
    const [members, setMembers] = useState<Member[]>([]);
    const [busy, setBusy] = useState<'save' | 'archive' | 'restore' | 'delete' | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [entity, memberList] = await Promise.all([
                    isSpace
                        ? api.GET('/space/{id}', path).then(({ data, response }) => {
                              if (!response.ok || !data) throw new Error(`Couldn’t load this ${noun}`);
                              return { title: data.name, description: data.description ?? '', isArchived: data.isArchived };
                          })
                        : api.GET('/document/{id}', path).then(({ data, response }) => {
                              if (!response.ok || !data) throw new Error(`Couldn’t load this ${noun}`);
                              return { title: data.title, description: '', isArchived: data.isArchived };
                          }),
                    (isSpace ? api.GET('/space/{id}/members', path) : api.GET('/document/{id}/members', path)).then(({ data }) =>
                        Array.isArray(data) ? (data as Member[]) : [],
                    ),
                ]);
                if (cancelled) return;
                setSaved({ title: entity.title, description: entity.description });
                setTitle(entity.title);
                setDescription(entity.description);
                setIsArchived(entity.isArchived);
                setMembers(memberList);
            } catch (err) {
                if (!cancelled) setLoadError(caughtMessage(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per opening
    }, [entityId, isSpace]);

    const me = members.find((m) => m.userId === user?.id);
    const isOwner = me?.role === 'OWNER';
    const dirty = title.trim() !== saved.title || (isSpace && description.trim() !== saved.description);
    const titleError = isSpace && title.trim().length < 3 ? 'Use at least 3 characters.' : !title.trim() ? 'Enter a name.' : null;

    /** `self: false` after archive/delete: the entity is gone, refetching it would only 404. */
    const refreshLists = ({ self = true } = {}) => {
        invalidate(keys.spaces);
        invalidate(keys.recent);
        if (self) invalidate(isSpace ? keys.space(entityId) : keys.document(entityId));
        if (spaceId) invalidate(keys.space(spaceId));
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (titleError || !dirty) return;
        setBusy('save');
        setSaveError(null);
        try {
            const result = isSpace
                ? await api.PATCH('/space/{id}', { ...path, body: { title: title.trim(), description: description.trim() } })
                : await api.PATCH('/document/{id}', { ...path, body: { title: title.trim() } });
            ensureOk(result, 'Couldn’t save the changes. Editors and owners can rename.');
            setSaved({ title: title.trim(), description: description.trim() });
            refreshLists();
            toast({ title: 'Changes saved' });
        } catch (err) {
            setSaveError(caughtMessage(err));
        } finally {
            setBusy(null);
        }
    };

    const restore = async () => {
        setBusy('restore');
        const { response, error } = isSpace ? await api.POST('/space/{id}/restore', path) : await api.POST('/document/{id}/restore', path);
        setBusy(null);
        if (!response.ok) {
            toast({ tone: 'error', title: 'Couldn’t restore', description: restoreErrorMessage(response.status, error, entityType) });
            return;
        }
        setIsArchived(false);
        refreshLists();
        reloadSpaces();
        toast({ title: `Restored the ${noun}` });
        onRestored?.();
    };

    const archive = async () => {
        setBusy('archive');
        const result = isSpace ? await api.POST('/space/{id}/archive', path) : await api.POST('/document/{id}/archive', path);
        setBusy(null);
        try {
            ensureOk(result, `Couldn’t archive the ${noun}. Only owners can archive.`);
        } catch (err) {
            toast({ tone: 'error', title: caughtMessage(err) });
            return;
        }
        refreshLists({ self: false });
        onClose();
        onRemoved('archived');
        toast({
            title: isSpace ? 'Space archived' : 'Moved to the trash',
            description: isSpace ? 'It’s hidden with its documents. Owners can restore it.' : 'Owners can restore it.',
            action: {
                label: 'Undo',
                onClick: async () => {
                    const { response, error } = isSpace ? await api.POST('/space/{id}/restore', path) : await api.POST('/document/{id}/restore', path);
                    if (!response.ok) {
                        toast({ tone: 'error', title: 'Couldn’t undo', description: restoreErrorMessage(response.status, error, entityType) });
                        return;
                    }
                    refreshLists();
                    toast({ title: `Restored the ${noun}` });
                },
            },
        });
    };

    const remove = async () => {
        const ok = await confirm({
            title: `Delete “${saved.title}”?`,
            message: isSpace
                ? 'The space and all its documents are deleted for everyone. This can’t be undone.'
                : 'The document and its version history are deleted for everyone. This can’t be undone.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!ok) return;
        setBusy('delete');
        const result = isSpace ? await api.DELETE('/space/{id}', path) : await api.DELETE('/document/{id}', path);
        setBusy(null);
        try {
            ensureOk(result, `Couldn’t delete the ${noun}. Only owners can delete.`);
        } catch (err) {
            toast({ tone: 'error', title: caughtMessage(err) });
            return;
        }
        refreshLists({ self: false });
        onClose();
        onRemoved('deleted');
        toast({ title: `Deleted “${saved.title}”` });
    };

    if (loading) return <LoadingRegion />;
    if (loadError) return <Notice tone="error" title={loadError} className="mb-2" />;

    return (
        <div className="flex flex-col gap-5">
            <SegmentedControl
                label="Settings section"
                value={tab}
                onChange={setTab}
                options={[
                    { value: 'general', label: 'General' },
                    { value: 'people', label: `People (${members.length})` },
                ]}
                className="self-center"
            />

            {tab === 'general' ? (
                <>
                    {isArchived && (
                        <Notice
                            tone="warning"
                            title={`This ${noun} is archived`}
                            action={
                                isOwner ? (
                                    <Button size="sm" icon={ArchiveRestore} loading={busy === 'restore'} onClick={restore}>
                                        Restore
                                    </Button>
                                ) : undefined
                            }
                        >
                            {isOwner ? 'Restore it to make it visible to its members again.' : 'Only owners can restore it.'}
                        </Notice>
                    )}
                    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
                        {saveError && <Notice tone="error" title={saveError} />}
                        <TextField
                            label="Name"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            error={dirty ? titleError : null}
                            maxLength={255}
                        />
                        {isSpace && (
                            <TextArea
                                label="Description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                maxLength={2000}
                            />
                        )}
                        <div className="flex justify-end">
                            <Button type="submit" variant="primary" disabled={!dirty || !!titleError} loading={busy === 'save'}>
                                Save Changes
                            </Button>
                        </div>
                    </form>

                    {isOwner && (
                        <section aria-labelledby="remove-heading" className="rounded-tile bg-grouped p-4">
                            <h3 id="remove-heading" className="text-body font-semibold">
                                Archive or Delete
                            </h3>
                            <p className="mt-1 text-footnote text-label-2">
                                {isSpace
                                    ? 'Archiving hides the space and its documents from everyone; you can restore it. Deleting removes them for good.'
                                    : 'Archiving moves the document to the trash; owners can restore it. Deleting removes it and its history for good.'}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {!isArchived && (
                                    <Button icon={Archive} loading={busy === 'archive'} disabled={!!busy} onClick={archive}>
                                        {isSpace ? 'Archive Space' : 'Move to Trash'}
                                    </Button>
                                )}
                                <Button variant="destructive-plain" icon={Trash2} loading={busy === 'delete'} disabled={!!busy} onClick={remove}>
                                    Delete {isSpace ? 'Space' : 'Document'}…
                                </Button>
                            </div>
                        </section>
                    )}
                </>
            ) : (
                <People
                    isSpace={isSpace}
                    entityId={entityId}
                    members={members}
                    setMembers={setMembers}
                    canManage={isOwner}
                    currentUserId={user?.id}
                />
            )}
        </div>
    );
}

function People({
    isSpace,
    entityId,
    members,
    setMembers,
    canManage,
    currentUserId,
}: {
    isSpace: boolean;
    entityId: string;
    members: Member[];
    setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
    canManage: boolean;
    currentUserId: string | undefined;
}) {
    const { toast } = useFeedback();
    const path = { params: { path: { id: entityId } } };
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<UserSummary[]>([]);
    const [searching, setSearching] = useState(false);
    const [inviteRole, setInviteRole] = useState<Role>('VIEWER');
    const [pending, setPending] = useState<string | null>(null);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 3) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        const timer = setTimeout(async () => {
            const { data } = await api.GET('/auth/users/search', { params: { query: { email: q } } });
            setResults(Array.isArray(data) ? data : []);
            setSearching(false);
        }, 300);
        return () => clearTimeout(timer);
    }, [query]);

    const owners = members.filter((m) => m.role === 'OWNER').length;

    const setRole = async (person: UserSummary, role: Role) => {
        setPending(person.id);
        const body = { userId: person.id, role };
        const result = isSpace
            ? await api.POST('/space/{id}/members', { ...path, body })
            : await api.POST('/document/{id}/members', { ...path, body });
        setPending(null);
        try {
            ensureOk(result, 'Couldn’t change access. Only owners can share.');
        } catch (err) {
            toast({ tone: 'error', title: caughtMessage(err) });
            return false;
        }
        setMembers((prev) => {
            const existing = prev.find((m) => m.userId === person.id);
            if (existing) return prev.map((m) => (m.userId === person.id ? { ...m, role, source: 'direct' } : m));
            return [...prev, { userId: person.id, role, user: person, source: 'direct' }];
        });
        return true;
    };

    const invite = async (person: UserSummary) => {
        if (await setRole(person, inviteRole)) {
            toast({ title: `Added ${person.email}`, description: `${ROLE_LABELS[inviteRole]}: ${ROLE_HELP[inviteRole].toLowerCase()}.` });
            setQuery('');
        }
    };

    const removeMember = async (member: Member) => {
        setPending(member.userId);
        const params = { params: { path: { id: entityId, userId: member.userId } } };
        const result = isSpace ? await api.DELETE('/space/{id}/members/{userId}', params) : await api.DELETE('/document/{id}/members/{userId}', params);
        setPending(null);
        try {
            ensureOk(result, 'Couldn’t remove access. Only owners can share.');
        } catch (err) {
            toast({ tone: 'error', title: caughtMessage(err) });
            return;
        }
        setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
        toast({ title: `Removed ${member.user.email}` });
    };

    const memberIds = new Set(members.map((m) => m.userId));

    return (
        <div className="flex flex-col gap-5">
            {canManage ? (
                <div className="relative">
                    <div className="flex items-end gap-2">
                        <div className="relative flex-1">
                            <TextField
                                label="Add people"
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search by email"
                                className="pl-8"
                                autoComplete="off"
                                hint={query.trim().length > 0 && query.trim().length < 3 ? 'Type at least 3 characters.' : undefined}
                            />
                            <Search className="pointer-events-none absolute left-2.5 top-[33px] size-4 text-label-3" aria-hidden />
                        </div>
                        <Select compact={false} aria-label="Role for new people" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className="w-[120px]">
                            <option value="VIEWER">Viewer</option>
                            <option value="EDITOR">Editor</option>
                            <option value="OWNER">Owner</option>
                        </Select>
                    </div>
                    {query.trim().length >= 3 && (
                        <div className="mt-2 rounded-field bg-grouped p-1" aria-live="polite">
                            {searching ? (
                                <div className="flex items-center gap-2 px-2.5 py-2 text-footnote text-label-2">
                                    <Spinner /> Searching…
                                </div>
                            ) : results.length === 0 ? (
                                <p className="px-2.5 py-2 text-footnote text-label-2">No one with that email has an account.</p>
                            ) : (
                                <ul>
                                    {results.map((person) => {
                                        const already = memberIds.has(person.id);
                                        return (
                                            <li key={person.id} className="flex items-center gap-2.5 rounded-control px-2.5 py-1.5">
                                                <Avatar name={person.email} colorKey={person.id} size={24} />
                                                <span className="flex-1 truncate text-body">{person.email}</span>
                                                {already ? (
                                                    <span className="text-footnote text-label-2">Has access</span>
                                                ) : (
                                                    <Button size="sm" variant="plain" icon={UserPlus} loading={pending === person.id} onClick={() => invite(person)}>
                                                        Add
                                                    </Button>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-footnote text-label-2">Only owners can change who has access.</p>
            )}

            <section aria-labelledby="members-heading">
                <h3 id="members-heading" className="mb-1.5 text-footnote font-semibold text-label-2">
                    People with access
                </h3>
                <ul className="divide-y divide-separator rounded-field bg-grouped">
                    {members.map((member) => {
                        const isSelf = member.userId === currentUserId;
                        const inherited = member.source === 'inherited';
                        const lastOwner = member.role === 'OWNER' && owners <= 1;
                        const locked = !canManage || inherited || (isSelf && lastOwner);
                        return (
                            <li key={member.userId} className="flex items-center gap-3 px-3 py-2">
                                <Avatar name={member.user.email} colorKey={member.userId} size={28} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-body text-label">
                                        {member.user.email}
                                        {isSelf && <span className="text-label-2"> (you)</span>}
                                    </p>
                                    <p className="text-footnote text-label-2">
                                        {inherited ? `${ROLE_LABELS[member.role]} through the space` : ROLE_HELP[member.role]}
                                    </p>
                                </div>
                                {locked ? (
                                    <span className={cn('text-footnote text-label-2', pending === member.userId && 'opacity-50')}>{ROLE_LABELS[member.role]}</span>
                                ) : (
                                    <>
                                        <Select
                                            compact
                                            aria-label={`Role of ${member.user.email}`}
                                            value={member.role}
                                            disabled={pending === member.userId}
                                            onChange={(e) => void setRole(member.user, e.target.value as Role)}
                                        >
                                            <option value="OWNER">Owner</option>
                                            <option value="EDITOR">Editor</option>
                                            <option value="VIEWER">Viewer</option>
                                        </Select>
                                        <button
                                            type="button"
                                            aria-label={`Remove ${member.user.email}`}
                                            title="Remove access"
                                            disabled={pending === member.userId}
                                            onClick={() => removeMember(member)}
                                            className="flex size-7 items-center justify-center rounded-control text-label-2 hover:bg-hover hover:text-danger disabled:opacity-40"
                                        >
                                            <X className="size-4" aria-hidden />
                                        </button>
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ul>
                {members.some((m) => m.source === 'inherited') && (
                    <p className="mt-2 text-footnote text-label-2">People with access through the space are managed in the space’s settings.</p>
                )}
            </section>
        </div>
    );
}
