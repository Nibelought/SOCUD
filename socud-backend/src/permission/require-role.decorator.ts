import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const REQUIRE_ROLE_KEY = 'permission:require-role';

export interface RequireRoleOptions {
  /** Kind of resource the id identifies. */
  resource: 'space' | 'document';
  /** Name of the route parameter (or body field) carrying the resource id. Default: `id`. */
  param?: string;
  /** Where to read the id from. Default: route params. */
  from?: 'params' | 'body';
  /** Document only: also resolve archived documents (restore / hard delete from the trash). */
  includeArchived?: boolean;
  /** Custom 403 message (space checks and archived-document OWNER checks). */
  message?: string;
}

export interface RequireRoleMetadata extends RequireRoleOptions {
  role: Role;
}

/**
 * Declares the minimum role needed for a route. Enforced by `RoleGuard`
 * (`@UseGuards(JwtAuthGuard, RoleGuard)`, JWT first so `req.user` is set).
 */
export const RequireRole = (role: Role, options: RequireRoleOptions) => {
  if (options.includeArchived && role !== Role.OWNER) {
    throw new Error('includeArchived is only supported with Role.OWNER');
  }
  return SetMetadata(REQUIRE_ROLE_KEY, {
    ...options,
    role,
  } satisfies RequireRoleMetadata);
};
