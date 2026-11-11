"use client";
"use no memo"; // useEditor returns one mutable Editor instance that is read during render; compiler memoization would go stale

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import { useRouter } from 'next/navigation';
import { Globe, Users, Eye, Edit2, Settings } from 'lucide-react';
import AccessManagerModal from '@/components/modals/AccessManagerModal';
import LatexEditorModal from "@/components/editor/LatexEditorModal";
import EditorToolbar from './EditorToolbar';
import { createEditorExtensions } from './createExtensions';
import { createMathDoubleClickExtension } from './extensions/mathDoubleClick';
import type { ActiveUser } from './useCollaboration';
import { api } from "@/lib/api/client";

// --- Inner editor ---
export default function EditorInner({ provider, ydoc, userName, userColor, activeUsers, currentUserId }: {
    provider: HocuspocusProvider;
    ydoc: Y.Doc;
    userName: string;
    userColor: string;
    activeUsers: ActiveUser[];
    currentUserId: string;
}) {
    const router = useRouter();
    const [isEditing, setIsEditing] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false); // modal state

    const [latexModal, setLatexModal] = useState({
        isOpen: false,
        initialLatex: '',
        isDisplay: false,
        isEditing: false,
        nodePos: undefined as number | undefined
    });

    // Stable callback for the extension (prevents recreating the editor)
    const handleMathDoubleClick = useCallback((latex: string, isDisplay: boolean, pos: number) => {
        setLatexModal({ isOpen: true, initialLatex: latex, isDisplay, isEditing: true, nodePos: pos });
    }, []);

    // Memoize the extension
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
        editable: isEditing,
        extensions,
    });

    useEffect(() => {
        if (editor) editor.setEditable(isEditing);
    }, [isEditing, editor]);

    const handlePublish = async () => {
        if (!editor) return;
        const html = editor.getHTML();
        try {
            const docId = provider.configuration.name;
            const { data, response } = await api.POST("/document/{id}/publish", {
                params: { path: { id: docId } },
                body: { html },
            });
            if (!response.ok || !data) throw new Error("Failed to publish");
            alert(`Published! Extracted links: ${data.extractedLinksCount}`);
        } catch (error) {
            console.error(error);
            alert("Error publishing.");
        }
    };

    if (!editor) return <div className="p-8 text-slate-500 animate-pulse">Initializing editor...</div>;

    return (
        <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Users className="w-4 h-4" />
                        <span className="font-medium">{activeUsers.length} active</span>
                    </div>
                    <div className="flex -space-x-2">
                        {activeUsers.map((u) => (
                            <div key={u.clientId} title={u.name} className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ backgroundColor: u.color }}>
                                {u.name.charAt(0).toUpperCase()}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Settings button */}
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    >
                        <Settings className="w-4 h-4" /> Settings
                    </button>

                    <button onClick={() => setIsEditing(!isEditing)} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${isEditing ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                        {isEditing ? <><Eye className="w-4 h-4" /> Preview</> : <><Edit2 className="w-4 h-4" /> Edit</>}
                    </button>

                    <button
                        onClick={() => router.push(`/document/${provider.configuration.name}/view`)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    >
                        <Eye className="w-4 h-4" /> View
                    </button>

                    <button onClick={handlePublish} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors">
                        <Globe className="w-4 h-4" /> Publish
                    </button>
                </div>
            </div>

            {isEditing && <EditorToolbar editor={editor} openLatexEditor={openLatexEditor} />}

            {/* Editor canvas: full height with correct scrolling */}
            <div className={`flex-1 overflow-y-auto p-8 ${!isEditing ? 'bg-slate-50/50' : ''}`}>
                <EditorContent
                    editor={editor}
                    className="prose prose-slate max-w-none focus:outline-none h-full [&_.ProseMirror]:min-h-full [&_.ProseMirror]:h-full"
                />
            </div>

            {/* Access modal */}
            <AccessManagerModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                entityId={provider.configuration.name}
                entityType="document"
                currentUserId={currentUserId}
                onDeleteSuccess={() => router.push('/dashboard')}
            />

            <LatexEditorModal
                isOpen={latexModal.isOpen}
                onClose={() => setLatexModal(prev => ({ ...prev, isOpen: false }))}
                editor={editor}
                initialLatex={latexModal.initialLatex}
                isDisplay={latexModal.isDisplay}
                isEditing={latexModal.isEditing}
                nodePos={latexModal.nodePos}
            />
        </div>
    );
}
