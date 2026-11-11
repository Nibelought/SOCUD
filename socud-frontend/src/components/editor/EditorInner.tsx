"use client";
"use no memo"; // useEditor returns one mutable Editor instance that is read during render; compiler memoization would go stale

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useEditor, EditorContent } from '@tiptap/react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import { Eye, History, MoreHorizontal, Send, Settings, Users, WifiOff } from 'lucide-react';
import { api } from '@/lib/api/client';
import { ensureOk, unwrap } from '@/lib/api/result';
import { caughtMessage } from '@/lib/api/errors';
import { plural } from '@/lib/format';
import { keys } from '@/lib/queries';
import { invalidate } from '@/hooks/useResource';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Bits';
import { useFeedback } from '@/components/ui/Feedback';
import { Menu } from '@/components/ui/Menu';
import { Page, Toolbar } from '@/components/shell/Page';
import { Breadcrumb } from '@/components/documents/DocumentParts';
import { VersionHistorySheet } from '@/components/documents/VersionHistorySheet';
import { SettingsSheet, type SettingsTab } from '@/components/sharing/SettingsSheet';
import LatexEditorModal from './LatexEditorModal';
import EditorToolbar from './EditorToolbar';
import { createEditorExtensions } from './createExtensions';
import { createMathDoubleClickExtension } from './extensions/mathDoubleClick';
import type { ActiveUser } from './useCollaboration';

export interface DocumentMeta {
    title: string;
    spaceId?: string;
    spaceName?: string;
}

/**
 * The editor screen's frame: toolbar with the document's path and actions, then the writing column.
 * Shared by the connecting state and the live editor so the screen doesn't jump when it connects.
 */
export function EditorFrame({
    documentId,
    meta,
    actions,
    formatBar,
    title,
    children,
}: {
    documentId: string;
    meta: DocumentMeta | undefined;
    actions?: ReactNode;
    formatBar?: ReactNode;
    title?: ReactNode;
    children: ReactNode;
}) {
    return (
        <Page
            toolbar={
                <Toolbar
                    leading={<Breadcrumb spaceId={meta?.spaceId} spaceName={meta?.spaceName} title={meta?.title || 'Untitled'} />}
                    actions={
                        actions ?? (
                            <ButtonLink href={`/document/${documentId}/view`} variant="secondary">
                                Done
                            </ButtonLink>
                        )
                    }
                />
            }
        >
            {formatBar && <div className="sticky top-[56px] z-20 flex justify-center px-3 pt-1">{formatBar}</div>}
            <div className="mx-auto w-full max-w-[740px] px-5 pt-8 pb-[40vh] sm:px-10">
                {title ?? <h1 className="mb-6 text-display font-bold tracking-[-0.02em] text-label">{meta?.title || ' '}</h1>}
                {children}
            </div>
        </Page>
    );
}

export default function EditorInner({
    provider,
    ydoc,
    userName,
    userColor,
    activeUsers,
    online,
    documentId,
    meta,
}: {
    provider: HocuspocusProvider;
    ydoc: Y.Doc;
    userName: string;
    userColor: string;
    activeUsers: ActiveUser[];
    online: boolean;
    documentId: string;
    meta: DocumentMeta | undefined;
}) {
    const router = useRouter();
    const { toast } = useFeedback();
    const [previewing, setPreviewing] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [settings, setSettings] = useState<SettingsTab | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [latexModal, setLatexModal] = useState({
        isOpen: false,
        initialLatex: '',
        isDisplay: false,
        isEditing: false,
        nodePos: undefined as number | undefined,
    });

    // Stable callback so the extension (and with it the editor) is not recreated.
    const handleMathDoubleClick = useCallback((latex: string, isDisplay: boolean, pos: number) => {
        setLatexModal({ isOpen: true, initialLatex: latex, isDisplay, isEditing: true, nodePos: pos });
    }, []);
    const MathDoubleClickEdit = useMemo(() => createMathDoubleClickExtension(handleMathDoubleClick), [handleMathDoubleClick]);

    const openLatexEditor = (initialLatex = '', isDisplay = false) => {
        setLatexModal({ isOpen: true, initialLatex, isDisplay, isEditing: false, nodePos: undefined });
    };

    const extensions = useMemo(
        () => createEditorExtensions({ ydoc, provider, userName, userColor, mathDoubleClickEdit: MathDoubleClickEdit }),
        [ydoc, provider, userName, userColor, MathDoubleClickEdit],
    );

    const editor = useEditor({
        immediatelyRender: false,
        editable: !previewing,
        extensions,
        editorProps: { attributes: { class: 'doc-content', 'aria-label': 'Document text' } },
    });

    useEffect(() => {
        editor?.setEditable(!previewing);
    }, [previewing, editor]);

    const publish = useCallback(async () => {
        if (!editor || publishing) return;
        setPublishing(true);
        try {
            const data = unwrap(
                await api.POST('/document/{id}/publish', { params: { path: { id: documentId } }, body: { html: editor.getHTML() } }),
                'Couldn’t publish. Editors and owners can publish.',
            );
            invalidate(keys.document(documentId));
            invalidate(keys.versions(documentId));
            invalidate(keys.recent);
            invalidate(keys.graph);
            const links = data.extractedLinksCount;
            toast({
                title: data.version ? `Published version ${data.version}` : 'Published',
                description: [
                    links > 0 ? `${plural(links, 'link')} to other documents found.` : null,
                    data.embeddingQueued === false ? 'Search will include it a little later.' : 'Search will include it shortly.',
                ]
                    .filter(Boolean)
                    .join(' '),
            });
        } catch (err) {
            toast({ tone: 'error', title: caughtMessage(err, 'Couldn’t publish') });
        } finally {
            setPublishing(false);
        }
    }, [editor, publishing, documentId, toast]);

    // ⌘S: changes save automatically; say so instead of opening the browser's Save dialog.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                toast({ tone: 'info', title: 'Changes save automatically', description: 'Publish to update what readers see.' });
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toast]);

    const others = activeUsers.filter((u, i, all) => all.findIndex((x) => x.name === u.name) === i && u.name !== userName);

    const actions = (
        <>
            {!online && (
                <span role="status" className="mr-1 flex items-center gap-1.5 rounded-full bg-warning-fill px-2.5 py-1 text-footnote font-medium text-warning">
                    <WifiOff className="size-3.5" aria-hidden /> Offline
                </span>
            )}
            {others.length > 0 && (
                <div className="mr-1 flex -space-x-1.5" aria-label={`Also editing: ${others.map((u) => u.name).join(', ')}`} role="group">
                    {others.slice(0, 4).map((u) => (
                        <Avatar key={u.clientId} name={u.name} colorKey={u.name} size={24} label={`${u.name} is editing`} ring />
                    ))}
                    {others.length > 4 && (
                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-fill-strong text-caption font-semibold text-label ring-2 ring-window">
                            +{others.length - 4}
                        </span>
                    )}
                </div>
            )}
            <IconButton icon={Eye} label={previewing ? 'Stop Previewing' : 'Preview'} active={previewing} aria-pressed={previewing} onClick={() => setPreviewing((p) => !p)} />
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
            <span className="hidden sm:contents">
                <ButtonLink href={`/document/${documentId}/view`}>Done</ButtonLink>
            </span>
            <Button variant="primary" icon={Send} loading={publishing} onClick={publish} disabled={!editor}>
                Publish
            </Button>
        </>
    );

    return (
        <EditorFrame
            documentId={documentId}
            meta={meta}
            actions={actions}
            formatBar={!previewing && editor ? <EditorToolbar editor={editor} openLatexEditor={openLatexEditor} /> : undefined}
            title={<TitleField documentId={documentId} meta={meta} readOnly={previewing} onEnter={() => editor?.commands.focus('start')} />}
        >
            <EditorContent editor={editor} />

            <SettingsSheet
                open={settings !== null}
                initialTab={settings ?? 'general'}
                onClose={() => setSettings(null)}
                entityType="document"
                entityId={documentId}
                spaceId={meta?.spaceId}
                onRemoved={() => router.push(meta?.spaceId ? `/space/${meta.spaceId}` : '/dashboard')}
            />
            <VersionHistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} documentId={documentId} />
            <LatexEditorModal
                isOpen={latexModal.isOpen}
                onClose={() => setLatexModal((prev) => ({ ...prev, isOpen: false }))}
                editor={editor}
                initialLatex={latexModal.initialLatex}
                isDisplay={latexModal.isDisplay}
                isEditing={latexModal.isEditing}
                nodePos={latexModal.nodePos}
            />
        </EditorFrame>
    );
}

/**
 * The document's title, edited in place like the first line of a note. Saved when it loses focus
 * or on Return (which then moves into the text).
 */
function TitleField({ documentId, meta, readOnly, onEnter }: { documentId: string; meta: DocumentMeta | undefined; readOnly: boolean; onEnter: () => void }) {
    const { toast } = useFeedback();
    const saved = meta?.title ?? '';
    const [value, setValue] = useState(saved);
    const [lastSaved, setLastSaved] = useState(saved);
    const ref = useRef<HTMLTextAreaElement>(null);

    // Adopt the server title when it arrives or changes elsewhere (not while typing).
    useEffect(() => {
        if (document.activeElement !== ref.current) {
            setValue(saved);
            setLastSaved(saved);
        }
    }, [saved]);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);

    const save = async () => {
        const next = value.trim();
        if (!next || next === lastSaved) {
            setValue(lastSaved);
            return;
        }
        try {
            ensureOk(
                await api.PATCH('/document/{id}', { params: { path: { id: documentId } }, body: { title: next } }),
                'Couldn’t rename. Editors and owners can rename.',
            );
            setLastSaved(next);
            setValue(next);
            invalidate(keys.document(documentId));
            if (meta?.spaceId) invalidate(keys.space(meta.spaceId));
            invalidate(keys.recent);
        } catch (err) {
            setValue(lastSaved);
            toast({ tone: 'error', title: caughtMessage(err, 'Couldn’t rename the document') });
        }
    };

    return (
        <textarea
            ref={ref}
            value={value}
            readOnly={readOnly}
            rows={1}
            aria-label="Title"
            placeholder="Untitled"
            maxLength={255}
            onChange={(e) => setValue(e.target.value.replace(/\n/g, ''))}
            onBlur={save}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onEnter();
                } else if (e.key === 'Escape') {
                    setValue(lastSaved);
                    e.currentTarget.blur();
                }
            }}
            className="mb-6 block w-full resize-none overflow-hidden bg-transparent text-display font-bold tracking-[-0.02em] text-label outline-none placeholder:text-label-3"
        />
    );
}
