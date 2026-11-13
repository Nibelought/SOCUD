import { api, type components } from './api/client';
import { unwrap } from './api/result';

/**
 * Cache keys and loaders shared by screens, so the sidebar, a space screen and a document screen
 * read the same cached data. Pass these to useResource; call invalidate(key) after a change.
 */
export type SpaceDetail = components['schemas']['SpaceDetailDto'];
export type DocumentView = components['schemas']['DocumentViewDto'];
export type RecentDocument = components['schemas']['RecentDocumentDto'];

export const keys = {
    spaces: 'spaces',
    space: (id: string) => `space:${id}`,
    document: (id: string) => `document:${id}`,
    versions: (id: string) => `versions:${id}`,
    recent: 'recent',
    graph: 'graph',
};

export async function fetchSpace(id: string): Promise<SpaceDetail> {
    return unwrap(await api.GET('/space/{id}', { params: { path: { id } } }), 'Couldn’t load this space');
}

export async function fetchDocument(id: string): Promise<DocumentView> {
    return unwrap(await api.GET('/document/{id}', { params: { path: { id } } }), 'Couldn’t load this document');
}

export async function fetchRecent(): Promise<RecentDocument[]> {
    return unwrap(await api.GET('/document/recent'), 'Couldn’t load recent documents');
}
