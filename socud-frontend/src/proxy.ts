import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, decideRoute } from './lib/session';

/**
 * Next.js 16 "proxy" (the renamed `middleware`): optimistic UX redirects based on the
 * `socud_session` hint cookie the API sets on login/refresh and clears on logout.
 *
 *  - protected routes (/dashboard, /space, /document, /graph) without the hint -> /login?next=...
 *  - /login and /register with the hint -> back into the app (?next= or /dashboard)
 *
 * This is NOT a security boundary. The hint is a plain, forgeable cookie; it only saves signed-out
 * users from a flash of protected UI. Every API call is authenticated by the backend (JWT / refresh
 * cookie), so a forged hint exposes nothing. The real session lives in the httpOnly refresh cookie
 * (path /auth, invisible to this code) and the access token in localStorage.
 *
 * Set SESSION_REDIRECTS=off in the web app's environment to disable the redirects entirely (e.g. if
 * the web app and the API are on unrelated domains, so the hint cookie can never be seen here).
 */
export function proxy(request: NextRequest): NextResponse {
  if (process.env.SESSION_REDIRECTS === 'off') return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const decision = decideRoute({
    pathname,
    search,
    hasSession: request.cookies.get(SESSION_COOKIE_NAME)?.value === '1',
  });

  if (decision.action === 'redirect') {
    // `to` is always a same-origin relative path built by decideRoute (validated).
    return NextResponse.redirect(new URL(decision.to, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/space/:path*',
    '/document/:path*',
    '/graph/:path*',
    '/login',
    '/register',
  ],
};
