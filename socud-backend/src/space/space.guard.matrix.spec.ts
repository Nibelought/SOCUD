import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role } from '@prisma/client';
import { SpaceController } from './space.controller';
import { SpaceService } from './space.service';
import { PermissionService } from '../permission/permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../permission/role.guard';
import { requestMemoMiddleware } from '../permission/request-memo';
import { FakeJwtGuard } from '../test-utils/fake-jwt.guard';
import { createPrismaServiceMock } from '../test-utils/mocks';

/**
 * HTTP-level authorization matrix of SpaceController: the real controller, the real RoleGuard and
 * the real PermissionService over a mocked Prisma. The service is a stub, so a 2xx proves the GUARD
 * let the request through and a 403 that it stopped the request before the service ran. (The
 * service-level checks are covered by space.authz.matrix.spec.ts.)
 */

const m = (fn: unknown) => fn as jest.Mock;

const ACTOR = 'actor-id';
const SPACE = '5a1d0c2e-7b3f-4e8a-9c64-1f2e3d4c5b6a';
const TARGET = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

type Actor = 'OWNER' | 'EDITOR' | 'VIEWER' | 'NON_MEMBER' | 'ADMIN';
const ACTORS: Actor[] = ['OWNER', 'EDITOR', 'VIEWER', 'NON_MEMBER', 'ADMIN'];

type Method = 'get' | 'post' | 'patch' | 'delete';

const SERVICE_STUB = {
  findOne: { id: SPACE },
  updateSpace: { id: SPACE },
  removeSpace: { success: true },
  getMembers: [],
  upsertMember: {},
  removeMember: { success: true },
  archiveSpace: { id: SPACE },
};

interface Route {
  name: string;
  method: Method;
  path: string;
  body?: object;
  ok: number;
  allowed: Actor[];
  handler: keyof typeof SERVICE_STUB;
}

const READERS: Actor[] = ['OWNER', 'EDITOR', 'VIEWER', 'ADMIN'];
const WRITERS: Actor[] = ['OWNER', 'EDITOR', 'ADMIN'];
const OWNERS: Actor[] = ['OWNER', 'ADMIN'];

const ROUTES: Route[] = [
  {
    name: 'GET /space/:id',
    method: 'get',
    path: `/space/${SPACE}`,
    ok: 200,
    allowed: READERS,
    handler: 'findOne',
  },
  {
    name: 'GET /space/:id/members',
    method: 'get',
    path: `/space/${SPACE}/members`,
    ok: 200,
    allowed: READERS,
    handler: 'getMembers',
  },
  {
    name: 'PATCH /space/:id',
    method: 'patch',
    path: `/space/${SPACE}`,
    body: { title: 'New' },
    ok: 200,
    allowed: WRITERS,
    handler: 'updateSpace',
  },
  {
    name: 'POST /space/:id/members',
    method: 'post',
    path: `/space/${SPACE}/members`,
    body: { userId: TARGET, role: 'VIEWER' },
    ok: 201,
    allowed: OWNERS,
    handler: 'upsertMember',
  },
  {
    name: 'DELETE /space/:id/members/:userId',
    method: 'delete',
    path: `/space/${SPACE}/members/${TARGET}`,
    ok: 200,
    allowed: OWNERS,
    handler: 'removeMember',
  },
  {
    name: 'POST /space/:id/archive',
    method: 'post',
    path: `/space/${SPACE}/archive`,
    ok: 201,
    allowed: OWNERS,
    handler: 'archiveSpace',
  },
  {
    name: 'DELETE /space/:id',
    method: 'delete',
    path: `/space/${SPACE}`,
    ok: 200,
    allowed: OWNERS,
    handler: 'removeSpace',
  },
];

describe('SpaceController authorization (RoleGuard, HTTP level)', () => {
  let app: INestApplication;
  let prisma: jest.Mocked<PrismaService>;
  let service: Record<string, jest.Mock>;

  function arrange(actor: Actor) {
    m(prisma.user.findUnique).mockResolvedValue({
      id: ACTOR,
      isSystemAdmin: actor === 'ADMIN',
    });
    const role = (['OWNER', 'EDITOR', 'VIEWER'] as const).includes(
      actor as 'OWNER',
    )
      ? (actor as Role)
      : null;
    m(prisma.spaceMember.findUnique).mockResolvedValue(
      role ? { userId: ACTOR, spaceId: SPACE, role } : null,
    );
  }

  const send = (
    route: Pick<Route, 'method' | 'path' | 'body'>,
    user = ACTOR,
  ) => {
    let req = request(app.getHttpServer() as App)[route.method](route.path);
    if (user) req = req.set('x-user', user);
    return route.body ? req.send(route.body) : req;
  };

  beforeEach(async () => {
    prisma = createPrismaServiceMock();
    service = Object.fromEntries(
      Object.entries(SERVICE_STUB).map(([name, value]) => [
        name,
        jest.fn().mockResolvedValue(value),
      ]),
    );
    service.create = jest.fn().mockResolvedValue({ id: SPACE });
    service.findAllForUser = jest.fn().mockResolvedValue([]);
    service.findMySpaces = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      controllers: [SpaceController],
      providers: [
        RoleGuard,
        PermissionService,
        { provide: PrismaService, useValue: prisma },
        { provide: SpaceService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(requestMemoMiddleware);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe.each(ACTORS)('actor: %s', (actor) => {
    it.each(ROUTES.map((r) => [r.name, r] as const))(
      '%s',
      async (_n, route) => {
        arrange(actor);
        const res = await send(route);

        if (route.allowed.includes(actor)) {
          expect(res.status).toBe(route.ok);
          expect(service[route.handler]).toHaveBeenCalledTimes(1);
        } else {
          expect(res.status).toBe(403);
          expect(service[route.handler]).not.toHaveBeenCalled();
        }
      },
    );
  });

  it('keeps the messages the services used to produce', async () => {
    arrange('VIEWER');
    const expected: Array<[Route, string]> = [
      [ROUTES[2], 'Only OWNERs and EDITORs can update space details'],
      [ROUTES[3], 'Only space OWNERs can manage members'],
      [ROUTES[5], 'Only space OWNERs can delete or archive this space'],
      [ROUTES[6], 'Only space OWNERs can hard delete this space'],
    ];
    for (const [route, message] of expected) {
      const res = await send(route);
      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toBe(message);
    }
    arrange('NON_MEMBER');
    const res = await send(ROUTES[0]);
    expect((res.body as { message: string }).message).toBe(
      'You do not have access to this space',
    );
  });

  describe('routes without a space id are JWT-only', () => {
    it.each([
      ['GET /space', 'get', '/space'],
      ['GET /space/my', 'get', '/space/my'],
    ] as const)(
      '%s passes for a non-member without a membership lookup',
      async (_n, method, path) => {
        arrange('NON_MEMBER');
        const res = await send({ method, path });
        expect(res.status).toBe(200);
        expect(prisma.spaceMember.findUnique).not.toHaveBeenCalled();
      },
    );

    it('POST /space passes for any authenticated user', async () => {
      arrange('NON_MEMBER');
      const res = await send({
        method: 'post',
        path: '/space',
        body: { name: 'Space' },
      });
      expect(res.status).toBe(201);
      expect(service.create).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['get', '/space'],
      ['get', '/space/my'],
      ['post', '/space'],
    ] as const)('%s %s needs a token (401)', async (method, path) => {
      const res = await send({ method, path, body: { name: 'Space' } }, '');
      expect(res.status).toBe(401);
    });
  });

  it.each(ROUTES.map((r) => [r.name, r] as const))(
    '%s needs a token (401) and never reaches the service',
    async (_n, route) => {
      arrange('OWNER');
      const res = await send(route, '');
      expect(res.status).toBe(401);
      expect(service[route.handler]).not.toHaveBeenCalled();
    },
  );

  it('a malformed id is a 400 and never queries the database', async () => {
    arrange('OWNER');
    const res = await send({ method: 'get', path: '/space/not-a-uuid' });
    expect(res.status).toBe(400);
    expect(prisma.spaceMember.findUnique).not.toHaveBeenCalled();
  });

  it('an unknown space is a 403 for a non-admin (as before) and reaches the service for an admin', async () => {
    // Nobody is a member of a space that does not exist; only the admin passes the guard
    // and then gets the service's own 404.
    arrange('NON_MEMBER');
    expect((await send(ROUTES[0])).status).toBe(403);
    arrange('ADMIN');
    expect((await send(ROUTES[0])).status).toBe(200);
  });
});
