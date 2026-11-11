import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PermissionService } from './permission.service';
import { SystemAdminGuard } from './system-admin.guard';

const ctx = (req: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('SystemAdminGuard', () => {
  const isSystemAdmin = jest.fn();
  const guard = new SystemAdminGuard({
    isSystemAdmin,
  } as unknown as PermissionService);

  beforeEach(() => isSystemAdmin.mockReset());

  it('admits a system admin', async () => {
    isSystemAdmin.mockResolvedValue(true);
    await expect(guard.canActivate(ctx({ user: { id: 'u' } }))).resolves.toBe(
      true,
    );
    expect(isSystemAdmin).toHaveBeenCalledWith('u');
  });

  it('answers 403 for a regular user', async () => {
    isSystemAdmin.mockResolvedValue(false);
    await expect(
      guard.canActivate(ctx({ user: { id: 'u' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 401 without an authenticated user, without touching the database', async () => {
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(isSystemAdmin).not.toHaveBeenCalled();
  });
});
