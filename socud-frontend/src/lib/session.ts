/**
 * Session hint shared by the Next.js proxy (server) and the browser code.
 *
 * The API keeps the real credentials in an httpOnly refresh cookie scoped to path `/auth`, which the
 * web app's proxy never receives, and the access token lives in localStorage. So on login/refresh
 * the API additionally sets `socud_session=1` (readable, path `/`, same lifetime) and clears it on
 * logout / rejected refresh. The proxy uses it ONLY to avoid flashing protected pages and to bounce
 * signed-out users to /login: it is a UX redirect, never a security boundary. Anyone can set the
 * cookie by hand and gets nothing: every API call is still authenticated server-side.
 */
export const SESSION_COOKIE_NAME = 'socud_session';

/** Query flag set when the client gave up on the session; stops the "signed-in -> away from /login" bounce. */
export const SESSION_EXPIRED_PARAM = 'session';
export const SESSION_EXPIRED_VALUE = 'expired';

/** Route prefixes that need a session. */
export const PROTECTED_PREFIXES = ['/dashboard', '/space', '/document', '/graph'] as const;
/** Pages only for signed-out users. */
export const AUTH_PAGES = ['/login', '/register'] as const;

export const DEFAULT_AFTER_LOGIN = '/dashboard';

const MAX_NEXT_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const matchesPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export const isProtectedPath = (pathname: string): boolean =>
  PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p));

export const isAuthPage = (pathname: string): boolean =>
  AUTH_PAGES.some((p) => matchesPrefix(pathname, p));

/** True for a string that is a same-origin relative reference after (repeated) percent-decoding. */
const looksSafe = (value: string): boolean =>
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !value.includes('\\') &&
  !CONTROL_CHARS.test(value);

/**
 * Validates a post-login return path (the `?next=` parameter) and returns it normalised, or null.
 * Accepts only same-origin absolute paths ("/dashboard", "/document/1?x=2#h"); rejects protocol-relative
 * URLs ("//evil.com"), backslash tricks ("/\evil.com"), control characters / whitespace tricks,
 * anything that changes origin when resolved, and the auth pages themselves (redirect loops).
 * The encoded and the decoded forms are both checked so "%2F%2Fevil.com" cannot slip through.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) {
    return null;
  }
  let candidate = raw;
  for (let i = 0; i < 3; i++) {
    if (!looksSafe(candidate)) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return null;
    }
    if (decoded === candidate) break;
    candidate = decoded;
  }
  if (!looksSafe(raw)) return null;

  const base = 'http://safe-next.invalid';
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  if (isAuthPage(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export type RouteDecision =
  | { action: 'next' }
  | { action: 'redirect'; to: string };

/**
 * Pure redirect matrix of the proxy.
 *  - protected route, no session hint  -> /login?next=<original path>
 *  - /login or /register, hint present -> ?next (validated) or /dashboard,
 *    unless the client flagged the session as expired (stale hint, would loop)
 *  - everything else                   -> pass through
 */
export function decideRoute(input: {
  pathname: string;
  search: string;
  hasSession: boolean;
}): RouteDecision {
  const { pathname, search, hasSession } = input;

  if (isProtectedPath(pathname) && !hasSession) {
    const back = safeNextPath(`${pathname}${search}`);
    return {
      action: 'redirect',
      to: back ? `/login?next=${encodeURIComponent(back)}` : '/login',
    };
  }

  if (isAuthPage(pathname) && hasSession) {
    const params = new URLSearchParams(search);
    if (params.get(SESSION_EXPIRED_PARAM) === SESSION_EXPIRED_VALUE) {
      return { action: 'next' };
    }
    return {
      action: 'redirect',
      to: safeNextPath(params.get('next')) ?? DEFAULT_AFTER_LOGIN,
    };
  }

  return { action: 'next' };
}

/** Path to send an unauthenticated browser to, preserving where it was (validated). */
export function loginUrl(opts: { expired?: boolean; next?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.expired) params.set(SESSION_EXPIRED_PARAM, SESSION_EXPIRED_VALUE);
  const next = safeNextPath(opts.next);
  if (next) params.set('next', next);
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}
