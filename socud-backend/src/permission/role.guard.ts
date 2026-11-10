import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionService } from './permission.service';
import {
  REQUIRE_ROLE_KEY,
  RequireRoleMetadata,
} from './require-role.decorator';

/**
 * Enforces `@RequireRole()`: resolves the resource id from the request and delegates to
 * `PermissionService`, so the status codes are the service's (404 missing/archived document,
 * 403 insufficient role). Routes without the decorator pass through.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequireRoleMetadata>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;

    const req = context.switchToHttp().getRequest<{
      user?: { id?: string };
      params?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();

    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();

    const source = meta.from === 'body' ? req.body : req.params;
    const resourceId = source?.[meta.param ?? 'id'];
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw new BadRequestException(
        `Missing resource identifier "${meta.param ?? 'id'}"`,
      );
    }

    if (meta.resource === 'space') {
      await this.permissions.assertSpaceRole(
        userId,
        resourceId,
        meta.role,
        meta.message,
      );
    } else if (meta.includeArchived) {
      // Archived documents are only reachable by their OWNERs (restore / hard delete).
      await this.permissions.assertDocumentOwner(
        userId,
        resourceId,
        meta.message ?? 'Only OWNERs can perform this action on the document',
      );
    } else {
      await this.permissions.assertDocumentRole(userId, resourceId, meta.role);
    }
    return true;
  }
}
