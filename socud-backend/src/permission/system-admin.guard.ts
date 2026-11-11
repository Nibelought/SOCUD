import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PermissionService } from './permission.service';

/**
 * Admits only system admins (`User.isSystemAdmin`). Use as
 * `@UseGuards(JwtAuthGuard, SystemAdminGuard)`: JWT first so `req.user` is set. 401 without a
 * user, 403 for everyone who is not a system admin.
 */
@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(private readonly permissions: PermissionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    if (!(await this.permissions.isSystemAdmin(userId))) {
      throw new ForbiddenException('System administrator access required');
    }
    return true;
  }
}
