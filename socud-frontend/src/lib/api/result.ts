import { apiErrorMessage } from './errors';

/** An HTTP error from the API, with its status, so screens can tell "not found" from "no access". */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

interface FetchResult<T> {
    data?: T;
    error?: unknown;
    response: Response;
}

/**
 * Returns `data` of an openapi-fetch result, or throws an ApiError with the server's message.
 * `fallback` is used when the server sent no message.
 */
export function unwrap<T>(result: FetchResult<T>, fallback = 'The request failed'): T {
    if (result.response.ok && result.data !== undefined) return result.data;
    throw new ApiError(result.response.status, apiErrorMessage(result.error, fallback));
}

/** Like unwrap, for responses without a body we need (204, `{ success: true }`). */
export function ensureOk(result: { error?: unknown; response: Response }, fallback = 'The request failed'): void {
    if (!result.response.ok) {
        throw new ApiError(result.response.status, apiErrorMessage(result.error, fallback));
    }
}

/** User-facing title for a failed load: what happened, in plain words. */
export function loadErrorTitle(err: unknown, thing: string): string {
    if (err instanceof ApiError) {
        if (err.status === 404) return `This ${thing} doesn’t exist or was moved to the trash`;
        if (err.status === 403) return `You don’t have access to this ${thing}`;
    }
    return `Couldn’t load this ${thing}`;
}
