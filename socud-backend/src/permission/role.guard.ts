import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { PermissionService } from './permission.service';
import {
  REQUIRE_ROLE_KEY,
  RequireRoleMetadata,
} from './require-role.decorator';

/**
 * Enforces `@RequireRole()`: resolves the resource id from the request and delegates to
 * `PermissionService`, so the status codes are the service's (404 missing/archived document,
 * 403 insufficient role). Routes without the decorator pass through. Ids must be UUIDs (a
 * malformed one is a 400, like `ParseUUIDPipe`).
 *
 * Applied at class level (`@UseGuards(JwtAuthGuard, RoleGuard)`) on `DocumentController` and
 * `SpaceController`: every route that targets a space or a document declares its minimum role, and
 * the HTTP-level matrix specs (`*.guard.matrix.spec.ts`) pin route x role -> status.
 *
 * The services deliberately KEEP their own checks (defence in depth): they are exported and
 * called outside HTTP routes' reach (and by the service-level matrix specs), and `findOne` needs the
 * row the check loads. Repeating the check costs no extra query within an HTTP request, because
 * `PermissionService` reuses the document and the admin flag the first check loaded
 * (`request-memo.ts`). One ordering consequence: the guard runs before the body is validated, so
 * a caller without the role gets 403 even for an invalid body.
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
    // Guards run before pipes: reject malformed ids with the same 400 as ParseUUIDPipe
    // instead of letting them reach the database and surface as 403/404/500.
    if (!isUUID(resourceId)) {
      throw new BadRequestException('Validation failed (uuid is expected)');
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
