"use client";

import { Loader2 } from 'lucide-react';
import EditorInner from './EditorInner';
import { useCollaboration } from './useCollaboration';

interface EditorProps {
    documentId: string;
    token: string;
    userName: string;
    userColor: string;
    currentUserId: string; // ← Новое поле
}

export default function DocumentEditor({ documentId, token, userName, userColor, currentUserId }: EditorProps) {
    const { ydoc, provider, status, activeUsers } = useCollaboration(documentId, token);

    if (status !== 'connected' || !provider) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <p>Connecting to secure document session...</p>
            </div>
        );
    }

    return <EditorInner provider={provider} ydoc={ydoc} userName={userName} userColor={userColor} activeUsers={activeUsers} currentUserId={currentUserId} />;
}
