import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/current-user';

/**
 * Stand-in for `JwtAuthGuard` in HTTP-level tests: authenticates by the `x-user` header
 * (401 without it) and sets `req.user` like `JwtStrategy.validate` does. Use with
 * `.overrideGuard(JwtAuthGuard).useClass(FakeJwtGuard)`.
 */
@Injectable()
export class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = req.headers['x-user'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new UnauthorizedException();
    }
    req.user = { id, email: `${id}@test.local`, isSystemAdmin: false };
    return true;
  }
}
