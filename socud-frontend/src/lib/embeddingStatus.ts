import type { components } from './api/schema';

export type EmbeddingStatus = components['schemas']['EmbeddingStatusDto'];

export const DISMISSED_KEY = 'socud_embedding_warning_dismissed';

/** Minimal shape of an openapi-fetch result (kept structural so tests need no network). */
export interface EmbeddingStatusResponse {
    data?: EmbeddingStatus;
    response: { ok: boolean };
}

/**
 * The status to warn about, or null when there is nothing to show: no mismatch, a non-admin (the
 * endpoint answers 403), a signed-out/expired session or any failure. Never throws: the banner is
 * advisory and must not disturb the page.
 */
export async function loadEmbeddingWarning(
    fetchStatus: () => Promise<EmbeddingStatusResponse>,
): Promise<EmbeddingStatus | null> {
    try {
        const { data, response } = await fetchStatus();
        if (!response.ok || !data || data.mismatch !== true) return null;
        return data;
    } catch {
        return null;
    }
}

/**
 * Identifies one warning situation. A dismissal only applies to the same active model and the same
 * set of stored models, so changing the model again brings the banner back.
 */
export function warningFingerprint(status: EmbeddingStatus): string {
    const stored = status.stored.map((s) => s.model).sort().join(',');
    return `${status.activeModel}|${stored}`;
}

export function isDismissed(status: EmbeddingStatus, storage: Pick<Storage, 'getItem'> | undefined): boolean {
    try {
        return storage?.getItem(DISMISSED_KEY) === warningFingerprint(status);
    } catch {
        return false; // storage blocked: show the banner
    }
}

export function rememberDismissal(status: EmbeddingStatus, storage: Pick<Storage, 'setItem'> | undefined): void {
    try {
        storage?.setItem(DISMISSED_KEY, warningFingerprint(status));
    } catch {
        // storage blocked: the banner just comes back on the next visit
    }
}

/** "model (N chunks in M documents)" list for the banner text. */
export function describeStoredModels(status: EmbeddingStatus): string {
    return status.stored
        .filter((s) => s.model !== status.activeModel)
        .map((s) => `${s.model} (${s.chunks} chunks in ${s.documents} documents)`)
        .join(', ');
}
