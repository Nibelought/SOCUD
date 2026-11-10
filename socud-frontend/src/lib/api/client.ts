import createClient from 'openapi-fetch';
import { fetchWithAuth } from '../auth';
import { API_URL } from '../config';
import type { paths } from './schema';

/**
 * Typed API client for authenticated endpoints (types generated from the backend's openapi.json,
 * see `npm run api:gen`). Every request carries the bearer access token; on a 401 the session is
 * refreshed once (single-flight, via the httpOnly cookie) and the request is retried; if that
 * fails the user is sent to /login.
 *
 * Like openapi-fetch in general it does not throw on HTTP errors: check `error` / `response.ok`.
 * Authenticated calls intentionally do not send cookies (bearer only), as before.
 */
export const api = createClient<paths>({
  baseUrl: API_URL,
  fetch: (request) => fetchWithAuth(request),
});

export { apiErrorMessage } from './errors';
export type { paths, components } from './schema';
