import { describe, expect, it, vi } from 'vitest';
import {
    DISMISSED_KEY,
    describeStoredModels,
    isDismissed,
    loadEmbeddingWarning,
    rememberDismissal,
    warningFingerprint,
    type EmbeddingStatus,
} from './embeddingStatus';

const QWEN = 'qwen3-embedding-4b@1024';
const OPENAI = 'openai/text-embedding-3-small@1024';

const status = (over: Partial<EmbeddingStatus> = {}): EmbeddingStatus => ({
    activeModel: OPENAI,
    provider: 'api',
    dim: 1024,
    stored: [{ model: QWEN, chunks: 120, documents: 14 }],
    mismatch: true,
    recommendedActions: ['re-embed', 'switch back', 'declare same space'],
    ...over,
});

describe('loadEmbeddingWarning', () => {
    it('returns the status on a mismatch', async () => {
        const s = status();
        await expect(loadEmbeddingWarning(async () => ({ data: s, response: { ok: true } }))).resolves.toBe(s);
    });

    it('returns null without a mismatch', async () => {
        const s = status({ mismatch: false, recommendedActions: [] });
        await expect(loadEmbeddingWarning(async () => ({ data: s, response: { ok: true } }))).resolves.toBeNull();
    });

    it.each([401, 403, 500])('returns null for a %i answer (non-admin, signed out, server error)', async (code) => {
        // openapi-fetch leaves `data` undefined and fills `error` for non-2xx answers
        await expect(loadEmbeddingWarning(async () => ({ response: { ok: false, status: code } as Response }))).resolves.toBeNull();
    });

    it('returns null when the request itself fails', async () => {
        await expect(
            loadEmbeddingWarning(async () => {
                throw new TypeError('Failed to fetch');
            }),
        ).resolves.toBeNull();
    });

    it('returns null for a malformed body', async () => {
        await expect(
            loadEmbeddingWarning(async () => ({ data: {} as EmbeddingStatus, response: { ok: true } })),
        ).resolves.toBeNull();
    });
});

describe('dismissal', () => {
    it('is remembered for the same situation only', () => {
        const store = new Map<string, string>();
        const storage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
        };
        const s = status();
        expect(isDismissed(s, storage)).toBe(false);

        rememberDismissal(s, storage);
        expect(store.get(DISMISSED_KEY)).toBe(warningFingerprint(s));
        expect(isDismissed(s, storage)).toBe(true);

        // another switch of the active model, or another stored model: warn again
        expect(isDismissed(status({ activeModel: 'other/model@1024' }), storage)).toBe(false);
        expect(
            isDismissed(
                status({ stored: [{ model: QWEN, chunks: 1, documents: 1 }, { model: 'x@1', chunks: 1, documents: 1 }] }),
                storage,
            ),
        ).toBe(false);
    });

    it('does not throw when storage is blocked', () => {
        const blocked = {
            getItem: vi.fn(() => {
                throw new Error('denied');
            }),
            setItem: vi.fn(() => {
                throw new Error('denied');
            }),
        };
        expect(isDismissed(status(), blocked)).toBe(false);
        expect(() => rememberDismissal(status(), blocked)).not.toThrow();
        expect(isDismissed(status(), undefined)).toBe(false);
    });
});

describe('describeStoredModels', () => {
    it('lists models other than the active one with their counts', () => {
        const s = status({
            stored: [
                { model: QWEN, chunks: 120, documents: 14 },
                { model: OPENAI, chunks: 4, documents: 1 },
            ],
        });
        expect(describeStoredModels(s)).toBe(`${QWEN} (120 chunks in 14 documents)`);
    });
});
