import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RoleGuard } from './role.guard';
import { PermissionService } from './permission.service';
import { RequireRole, RequireRoleOptions } from './require-role.decorator';

const USER = 'user-id';
const RES = '3f6d6b8e-0b0a-4c43-9d5c-0d6f1d2a9a11';

/** Builds a handler decorated with @RequireRole and an ExecutionContext for it. */
function setup(
  role: Role | null,
  options: RequireRoleOptions,
  req: Record<string, unknown>,
) {
  class Ctrl {
    handler() {}
  }
  if (role) {
    const descriptor = Object.getOwnPropertyDescriptor(
      Ctrl.prototype,
      'handler',
    )!;
    RequireRole(role, options)(Ctrl.prototype, 'handler', descriptor);
  }
  const context = {
    getHandler: () => Ctrl.prototype.handler,
    getClass: () => Ctrl,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return context;
}

describe('RoleGuard', () => {
  let permissions: {
    assertSpaceRole: jest.Mock;
    assertDocumentRole: jest.Mock;
    assertDocumentOwner: jest.Mock;
  };
  let guard: RoleGuard;

  beforeEach(() => {
    permissions = {
      assertSpaceRole: jest.fn().mockResolvedValue(undefined),
      assertDocumentRole: jest.fn().mockResolvedValue({}),
      assertDocumentOwner: jest.fn().mockResolvedValue({}),
    };
    guard = new RoleGuard(
      new Reflector(),
      permissions as unknown as PermissionService,
    );
  });

  it('passes through routes without @RequireRole', async () => {
    const ctx = setup(null, { resource: 'space' }, {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(permissions.assertSpaceRole).not.toHaveBeenCalled();
  });

  it('checks the space role using the route param', async () => {
    const ctx = setup(
      Role.EDITOR,
      { resource: 'space', param: 'spaceId', message: 'nope' },
      { user: { id: USER }, params: { spaceId: RES } },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(permissions.assertSpaceRole).toHaveBeenCalledWith(
      USER,
      RES,
      Role.EDITOR,
      'nope',
    );
  });

  it('defaults the param to "id" and reads documents through assertDocumentRole', async () => {
    const ctx = setup(
      Role.VIEWER,
      { resource: 'document' },
      { user: { id: USER }, params: { id: RES } },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(permissions.assertDocumentRole).toHaveBeenCalledWith(
      USER,
      RES,
      Role.VIEWER,
    );
  });

  it('can read the id from the body', async () => {
    const ctx = setup(
      Role.EDITOR,
      { resource: 'space', param: 'spaceId', from: 'body' },
      { user: { id: USER }, params: {}, body: { spaceId: RES } },
    );
    await guard.canActivate(ctx);
    expect(permissions.assertSpaceRole).toHaveBeenCalledWith(
      USER,
      RES,
      Role.EDITOR,
      undefined,
    );
  });

  it('uses the archived-aware OWNER check with includeArchived', async () => {
    const ctx = setup(
      Role.OWNER,
      { resource: 'document', includeArchived: true, message: 'owners only' },
      { user: { id: USER }, params: { id: RES } },
    );
    await guard.canActivate(ctx);
    expect(permissions.assertDocumentOwner).toHaveBeenCalledWith(
      USER,
      RES,
      'owners only',
    );
    expect(permissions.assertDocumentRole).not.toHaveBeenCalled();
  });

  it('propagates 403 and 404 from PermissionService unchanged', async () => {
    const ctx = setup(
      Role.OWNER,
      { resource: 'document' },
      { user: { id: USER }, params: { id: RES } },
    );
    permissions.assertDocumentRole.mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    permissions.assertDocumentRole.mockRejectedValueOnce(
      new NotFoundException(),
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const ctx = setup(
      Role.VIEWER,
      { resource: 'space' },
      { params: { id: RES } },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a missing resource id with 400 without calling the service', async () => {
    const ctx = setup(
      Role.VIEWER,
      { resource: 'space' },
      { user: { id: USER }, params: {} },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    expect(permissions.assertSpaceRole).not.toHaveBeenCalled();
  });

  it('rejects a malformed id with the same 400 as ParseUUIDPipe, before any lookup', async () => {
    const ctx = setup(
      Role.VIEWER,
      { resource: 'document' },
      { user: { id: USER }, params: { id: 'not-a-uuid' } },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new BadRequestException('Validation failed (uuid is expected)'),
    );
    expect(permissions.assertDocumentRole).not.toHaveBeenCalled();
  });

  it('refuses includeArchived for roles other than OWNER at declaration time', () => {
    expect(() =>
      RequireRole(Role.EDITOR, { resource: 'document', includeArchived: true }),
    ).toThrow();
  });
});
