import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtStrategy } from './jwt.strategy';
import { SpaceController } from '../../space/space.controller';
import { SpaceService } from '../../space/space.service';
import { PermissionService } from '../../permission/permission.service';
import { RoleGuard } from '../../permission/role.guard';
import { requestMemoMiddleware } from '../../permission/request-memo';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createConfigServiceMock,
  createPrismaServiceMock,
  TEST_ENV,
} from '../../test-utils/mocks';

const m = (fn: unknown) => fn as jest.Mock;

const USER = 'user-1';
const SPACE = '5a1d0c2e-7b3f-4e8a-9c64-1f2e3d4c5b6a';

/**
 * Real passport-jwt + JwtStrategy + RoleGuard over a mocked Prisma: proves that the admin flag
 * read for the request by JwtStrategy reaches PermissionService (no second read) and never
 * outlives the request (revoking admin is effective on the next request).
 */
describe('JwtStrategy and the per-request admin flag', () => {
  let app: INestApplication;
  let prisma: jest.Mocked<PrismaService>;
  let token: string;
  const getMembers = jest.fn();

  const setUser = (isSystemAdmin: boolean) =>
    m(prisma.user.findUnique).mockResolvedValue({
      id: USER,
      email: 'u@test.local',
      isSystemAdmin,
    });
  const call = () =>
    request(app.getHttpServer() as App)
      .get(`/space/${SPACE}/members`)
      .set('Authorization', `Bearer ${token}`);

  beforeEach(async () => {
    prisma = createPrismaServiceMock();
    getMembers.mockReset().mockResolvedValue([]);
    m(prisma.spaceMember.findUnique).mockResolvedValue(null); // not a member

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({ secret: String(TEST_ENV.JWT_SECRET) }),
      ],
      controllers: [SpaceController],
      providers: [
        JwtStrategy,
        RoleGuard,
        PermissionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: SpaceService, useValue: { getMembers } },
      ],
    }).compile();

    token = moduleRef
      .get(JwtService)
      .sign({ sub: USER, email: 'u@test.local' });
    app = moduleRef.createNestApplication();
    app.use(requestMemoMiddleware);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('validate() returns isSystemAdmin from the user row', async () => {
    const strategy = new JwtStrategy(prisma, createConfigServiceMock());
    setUser(true);
    await expect(strategy.validate({ sub: USER, email: 'x' })).resolves.toEqual(
      { id: USER, email: 'u@test.local', isSystemAdmin: true },
    );
  });

  it('an admin request reads the user row once (JwtStrategy), not again in PermissionService', async () => {
    setUser(true);
    const res = await call();
    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    // admin short-circuits the membership lookup
    expect(prisma.spaceMember.findUnique).not.toHaveBeenCalled();
  });

  it('revoking admin is effective on the very next request (no stale flag)', async () => {
    setUser(true);
    expect((await call()).status).toBe(200);

    setUser(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(getMembers).toHaveBeenCalledTimes(1);
  });

  it('a non-admin request also reads the user row once', async () => {
    setUser(false);
    expect((await call()).status).toBe(403);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('without a request context PermissionService still reads the database', async () => {
    const permissions = new PermissionService(prisma);
    setUser(true);
    await expect(permissions.isSystemAdmin(USER)).resolves.toBe(true);
    setUser(false);
    await expect(permissions.isSystemAdmin(USER)).resolves.toBe(false);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
