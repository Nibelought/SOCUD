"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { api } from "@/lib/api/client";
import {
    describeStoredModels,
    isDismissed,
    loadEmbeddingWarning,
    rememberDismissal,
    type EmbeddingStatus,
} from "@/lib/embeddingStatus";

/**
 * Warning for system admins when the search index holds vectors from another embedding model than
 * the one currently configured. Renders nothing for everyone else (the endpoint answers 403), when
 * there is no mismatch, after dismissal, and on any fetch failure. Never blocks anything.
 */
export default function EmbeddingModelBanner() {
    const [status, setStatus] = useState<EmbeddingStatus | null>(null);

    useEffect(() => {
        let cancelled = false;
        void loadEmbeddingWarning(() => api.GET('/admin/embedding-status')).then((result) => {
            if (cancelled || !result) return;
            let storage: Storage | undefined;
            try {
                storage = localStorage;
            } catch {
                storage = undefined;
            }
            if (!isDismissed(result, storage)) setStatus(result);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!status) return null;

    const dismiss = () => {
        try {
            rememberDismissal(status, localStorage);
        } catch {
            // storage unavailable: hide for this visit only
        }
        setStatus(null);
    };

    return (
        <div role="alert" className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-4 shadow-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm space-y-2">
                <p className="font-semibold">Embedding model changed: semantic search results may be unreliable</p>
                <p>
                    The search index was built with <code className="font-mono">{describeStoredModels(status)}</code>, but new
                    text is now embedded with <code className="font-mono">{status.activeModel}</code>. Vectors from different
                    models are not comparable, so results mixing them are unreliable. Search keeps working.
                </p>
                <p className="font-medium">Recommended actions</p>
                <ol className="list-decimal pl-5 space-y-1">
                    {status.recommendedActions.map((action) => (
                        <li key={action}>{action}</li>
                    ))}
                </ol>
            </div>
            <button
                onClick={dismiss}
                aria-label="Dismiss embedding model warning"
                className="p-1 rounded hover:bg-amber-100 text-amber-700 transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
