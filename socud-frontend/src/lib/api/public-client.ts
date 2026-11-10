import createClient from 'openapi-fetch';
import { API_URL } from '../config';
import type { paths } from './schema';

/**
 * Typed client for endpoints that must NOT carry a bearer token or retry on 401:
 * login, register, refresh and logout. Cookies are sent (`credentials: 'include'`) because the
 * httpOnly refresh cookie belongs to the API origin.
 *
 * `fetch` is resolved at call time (not captured at import) so tests can stub `globalThis.fetch`.
 */
export const publicApi = createClient<paths>({
  baseUrl: API_URL,
  credentials: 'include',
  fetch: (request) => globalThis.fetch(request),
});
