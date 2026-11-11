import { useEffect, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { WS_URL } from "@/lib/config";

export interface ActiveUser {
    clientId: number;
    name: string;
    color: string;
}

/** Connects a Hocuspocus provider for a document and tracks connection status and present users. */
export function useCollaboration(documentId: string, token: string) {
    const [ydoc] = useState(() => new Y.Doc());
    const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
    const [status, setStatus] = useState<string>('connecting');
    const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);

    useEffect(() => {
        let isMounted = true;
        const newProvider = new HocuspocusProvider({
            url: WS_URL,
            name: documentId,
            document: ydoc,
            token: token,
            onStatus: ({ status }) => { if (isMounted) setStatus(status); },
        });

        newProvider.awareness!.on('change', () => {
            if (!isMounted) return;
            const states = Array.from(newProvider.awareness!.getStates().entries());
            const users = states.filter(([, state]) => state?.user?.name).map(([clientId, state]) => ({
                clientId, name: state.user.name, color: state.user.color,
            }));
            setActiveUsers(users);
        });

        setProvider(newProvider);
        return () => { isMounted = false; newProvider.destroy(); };
    }, [documentId, token, ydoc]);

    return { ydoc, provider, status, activeUsers };
}
