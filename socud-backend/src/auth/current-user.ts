import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * What `JwtStrategy.validate` puts on `req.user`. Everything is read from the database on every
 * request (nothing is trusted from the token except the subject), so `isSystemAdmin` reflects
 * a revocation immediately.
 */
export interface AuthUser {
  id: string;
  email: string;
  isSystemAdmin: boolean;
}

/** An Express request that passed `JwtAuthGuard`. */
export type AuthenticatedRequest = Request & { user: AuthUser };

/**
 * Injects the authenticated user (or one of its fields) into a handler parameter:
 * `@CurrentUser() user: AuthUser` or `@CurrentUser('id') userId: string`.
 * Only meaningful behind `JwtAuthGuard`.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return field ? user[field] : user;
  },
);
