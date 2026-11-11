import { describe, expect, it } from 'vitest';
import { restoreErrorMessage } from './restore';

describe('restoreErrorMessage', () => {
    it('explains a 409 conflict per entity type', () => {
        expect(restoreErrorMessage(409, { message: 'Document is not archived' }, 'document'))
            .toBe('This document is not archived, so there is nothing to restore.');
        expect(restoreErrorMessage(409, undefined, 'space'))
            .toBe('This space is not archived, so there is nothing to restore.');
    });

    it('uses the backend message for other failures', () => {
        expect(restoreErrorMessage(403, { statusCode: 403, message: 'Insufficient role' }, 'space')).toBe('Insufficient role');
    });

    it('falls back to a generic message', () => {
        expect(restoreErrorMessage(500, undefined, 'document')).toBe('Failed to restore. Requires OWNER permissions.');
    });
});
