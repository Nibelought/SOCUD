"use client";

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Bits';
import EditorInner, { EditorFrame, type DocumentMeta } from './EditorInner';
import { useCollaboration } from './useCollaboration';

interface EditorProps {
    documentId: string;
    token: string;
    userName: string;
    userColor: string;
    meta: DocumentMeta | undefined;
}

const SLOW_CONNECT_MS = 8000;

/**
 * Collaborative editor screen. Waits for the first connection to the editing server (so nobody
 * types into an empty copy before the document arrives); later disconnections keep the editor open
 * and show an offline status: Yjs merges the edits when the connection returns.
 */
export default function DocumentEditor({ documentId, token, userName, userColor, meta }: EditorProps) {
    const { ydoc, provider, status, activeUsers } = useCollaboration(documentId, token);
    const [everConnected, setEverConnected] = useState(false);
    const [slow, setSlow] = useState(false);

    // Adjusting state while rendering (not in an effect): remember the first connection.
    if (status === 'connected' && !everConnected) setEverConnected(true);

    useEffect(() => {
        if (everConnected) return;
        const timer = setTimeout(() => setSlow(true), SLOW_CONNECT_MS);
        return () => clearTimeout(timer);
    }, [everConnected]);

    if (!provider || !everConnected) {
        return (
            <EditorFrame documentId={documentId} meta={meta}>
                {slow ? (
                    <EmptyState
                        icon={WifiOff}
                        title="Can’t reach the editing server"
                        action={<Button onClick={() => window.location.reload()}>Try Again</Button>}
                    >
                        SOCUD keeps trying. If this continues, check your connection or ask an administrator whether the editing service is running.
                    </EmptyState>
                ) : (
                    <div aria-hidden className="flex flex-col gap-4 pt-2">
                        {[94, 88, 97, 72, 90, 60].map((w) => (
                            <div key={w} className="animate-shimmer h-3.5 rounded bg-fill" style={{ width: `${w}%` }} />
                        ))}
                        <p className="sr-only" role="status">
                            Opening the document
                        </p>
                    </div>
                )}
            </EditorFrame>
        );
    }

    return (
        <EditorInner
            provider={provider}
            ydoc={ydoc}
            userName={userName}
            userColor={userColor}
            activeUsers={activeUsers}
            online={status === 'connected'}
            documentId={documentId}
            meta={meta}
        />
    );
}
