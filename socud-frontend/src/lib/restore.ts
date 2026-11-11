import { apiErrorMessage } from './api/errors';

/**
 * User-facing message for a failed `POST /space|document/{id}/restore`.
 * 409 means the entity is not archived (e.g. restored from another tab); other statuses
 * fall back to the backend message or a generic permission hint.
 */
export function restoreErrorMessage(status: number, error: unknown, entityType: 'space' | 'document'): string {
    if (status === 409) return `This ${entityType} is not archived, so there is nothing to restore.`;
    return apiErrorMessage(error, 'Failed to restore. Requires OWNER permissions.', '\n');
}
