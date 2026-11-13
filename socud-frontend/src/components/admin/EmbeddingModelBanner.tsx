"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import {
    describeStoredModels,
    isDismissed,
    loadEmbeddingWarning,
    rememberDismissal,
    type EmbeddingStatus,
} from "@/lib/embeddingStatus";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Feedback";

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

    const code = "rounded bg-fill px-1 font-mono text-footnote text-label";

    return (
        <Notice
            tone="warning"
            title="Semantic search may return unreliable results"
            className="mb-8"
            action={<Button size="sm" onClick={dismiss}>Dismiss</Button>}
        >
            <p>
                The search index was built with <code className={code}>{describeStoredModels(status)}</code>, but new
                text is now embedded with <code className={code}>{status.activeModel}</code>
                {status.profile ? (
                    <>
                        {' '}
                        (embedding profile <code className={code}>{status.profile}</code>)
                    </>
                ) : null}
                . Vectors from different models aren’t comparable. Keyword search is unaffected.
            </p>
            <p className="mt-2 font-medium text-label">Recommended actions</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
                {status.recommendedActions.map((action) => (
                    <li key={action}>{action}</li>
                ))}
            </ol>
        </Notice>
    );
}
