import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { DocumentWithAccess } from './permission.service';

/**
 * Per-HTTP-request memo, so the access checks a request performs more than once (the route's
 * `RoleGuard`, then the service's own defence-in-depth check) cost one database read each:
 *
 * - `systemAdmin`: the flag `JwtStrategy.validate` just read from the `User` row of THIS request.
 *   It is never carried in the JWT and never outlives the request, so revoking admin takes effect
 *   on the very next request.
 * - `documents`: the document row (with the caller's memberships) loaded by the first check; the archived/404
 *   rule is applied on every read, so only the database round-trip is saved.
 *
 * Outside an HTTP request (Hocuspocus, queue, scripts, unit tests) there is no store and every
 * lookup falls back to the database exactly as before.
 */
interface RequestMemo {
  systemAdmin: Map<string, boolean>;
  documents: Map<string, DocumentWithAccess>;
}

const storage = new AsyncLocalStorage<RequestMemo>();

/** Express middleware that opens a fresh memo for every request. Register it before the routes. */
export function requestMemoMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  storage.run({ systemAdmin: new Map(), documents: new Map() }, next);
}

/** Records the admin flag read for `userId` in this request (no-op outside a request). */
export function rememberSystemAdmin(userId: string, isAdmin: boolean): void {
  storage.getStore()?.systemAdmin.set(userId, isAdmin);
}

/** The flag remembered for `userId` in this request, or `undefined` if unknown. */
export function recalledSystemAdmin(userId: string): boolean | undefined {
  return storage.getStore()?.systemAdmin.get(userId);
}

/** Remembers the document row loaded for `userId` (archived or not: callers apply the 404 rule). */
export function rememberDocument(
  userId: string,
  documentId: string,
  doc: DocumentWithAccess,
): void {
  storage.getStore()?.documents.set(`${userId}:${documentId}`, doc);
}

export function recalledDocument(
  userId: string,
  documentId: string,
): DocumentWithAccess | undefined {
  return storage.getStore()?.documents.get(`${userId}:${documentId}`);
}
