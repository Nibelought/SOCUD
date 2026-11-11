import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role } from '@prisma/client';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { SearchService } from '../search/search.service';
import { PermissionService } from '../permission/permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../permission/role.guard';
import { requestMemoMiddleware } from '../permission/request-memo';
import { FakeJwtGuard } from '../test-utils/fake-jwt.guard';
import { createPrismaServiceMock } from '../test-utils/mocks';

/**
 * HTTP-level authorization matrix of DocumentController: the real controller, the real RoleGuard
 * and the real PermissionService over a mocked Prisma. The service is a stub, so a 2xx proves the
 * GUARD let the request through and a 403/404 that the guard stopped it before the service ran.
 * (The service-level checks are covered by document.authz.matrix.spec.ts.)
 */

const m = (fn: unknown) => fn as jest.Mock;

const ACTOR = 'actor-id';
const DOC = '3f6d6b8e-0b0a-4c43-9d5c-0d6f1d2a9a11';
const SPACE = '5a1d0c2e-7b3f-4e8a-9c64-1f2e3d4c5b6a';
const TARGET = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

interface Scenario {
  label: string;
  spaceRole?: Role;
  docRole?: Role;
  admin?: boolean;
}

// Same scenarios and column order as document.authz.matrix.spec.ts.
const SCENARIOS: Scenario[] = [
  { label: 'space OWNER', spaceRole: Role.OWNER },
  { label: 'space EDITOR', spaceRole: Role.EDITOR },
  { label: 'space VIEWER', spaceRole: Role.VIEWER },
  { label: 'non-member' },
  { label: 'system admin', admin: true },
  {
    label: 'space VIEWER + document EDITOR override',
    spaceRole: Role.VIEWER,
    docRole: Role.EDITOR,
  },
  {
    label: 'space EDITOR + document VIEWER override',
    spaceRole: Role.EDITOR,
    docRole: Role.VIEWER,
  },
  {
    label: 'space VIEWER + document OWNER override',
    spaceRole: Role.VIEWER,
    docRole: Role.OWNER,
  },
  { label: 'non-member + document EDITOR override', docRole: Role.EDITOR },
];

//                sOWN   sEDT   sVWR   none   ADMIN  v+dE   e+dV   v+dO   n+dE
const READ = [true, true, true, false, true, true, true, true, true];
const WRITE = [true, true, false, false, true, true, false, true, true];
const OWNER = [true, false, false, false, true, false, false, true, false];

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface Route {
  name: string;
  method: Method;
  path: string;
  body?: object;
  /** Expected success status. */
  ok: number;
  /** Which scenarios may pass the guard. */
  allowed: boolean[];
  /** Service method that must run exactly once on success and never on denial. */
  handler: keyof typeof SERVICE_STUB;
}

const SERVICE_STUB = {
  findOne: { id: DOC },
  getMembersWithInheritance: [],
  upsertDocumentMember: {},
  removeDocumentMember: { success: true },
  archive: { id: DOC },
  update: { id: DOC },
  remove: { success: true },
  listVersions: [],
  getVersion: {},
  publishDocument: { success: true },
  create: { id: DOC },
};

const ROUTES: Route[] = [
  {
    name: 'GET /document/:id',
    method: 'get',
    path: `/document/${DOC}`,
    ok: 200,
    allowed: READ,
    handler: 'findOne',
  },
  {
    name: 'GET /document/:id/members',
    method: 'get',
    path: `/document/${DOC}/members`,
    ok: 200,
    allowed: READ,
    handler: 'getMembersWithInheritance',
  },
  {
    name: 'GET /document/:id/versions',
    method: 'get',
    path: `/document/${DOC}/versions`,
    ok: 200,
    allowed: READ,
    handler: 'listVersions',
  },
  {
    name: 'GET /document/:id/versions/:version',
    method: 'get',
    path: `/document/${DOC}/versions/1`,
    ok: 200,
    allowed: READ,
    handler: 'getVersion',
  },
  {
    name: 'PATCH /document/:id',
    method: 'patch',
    path: `/document/${DOC}`,
    body: { title: 'T' },
    ok: 200,
    allowed: WRITE,
    handler: 'update',
  },
  {
    name: 'POST /document/:id/publish',
    method: 'post',
    path: `/document/${DOC}/publish`,
    body: { html: '<p>x</p>' },
    ok: 201,
    allowed: WRITE,
    handler: 'publishDocument',
  },
  {
    name: 'POST /document/:id/archive',
    method: 'post',
    path: `/document/${DOC}/archive`,
    ok: 201,
    allowed: OWNER,
    handler: 'archive',
  },
  {
    name: 'POST /document/:id/members',
    method: 'post',
    path: `/document/${DOC}/members`,
    body: { userId: TARGET, role: 'EDITOR' },
    ok: 201,
    allowed: OWNER,
    handler: 'upsertDocumentMember',
  },
  {
    name: 'PUT /document/:id/members',
    method: 'put',
    path: `/document/${DOC}/members`,
    body: { userId: TARGET, role: 'EDITOR' },
    ok: 200,
    allowed: OWNER,
    handler: 'upsertDocumentMember',
  },
  {
    name: 'DELETE /document/:id/members/:userId',
    method: 'delete',
    path: `/document/${DOC}/members/${TARGET}`,
    ok: 200,
    allowed: OWNER,
    handler: 'removeDocumentMember',
  },
  {
    name: 'DELETE /document/:id',
    method: 'delete',
    path: `/document/${DOC}`,
    ok: 200,
    allowed: OWNER,
    handler: 'remove',
  },
  {
    // The space id comes from the body; the space role EDITOR is required.
    name: 'POST /document (space EDITOR via body.spaceId)',
    method: 'post',
    path: '/document',
    body: { spaceId: SPACE, title: 'T' },
    ok: 201,
    // Only the SPACE role counts here (document overrides do not): sOWN sEDT sVWR none ADMIN ...
    allowed: [true, true, false, false, true, false, true, false, false],
    handler: 'create',
  },
];

describe('DocumentController authorization (RoleGuard, HTTP level)', () => {
  let app: INestApplication;
  let prisma: jest.Mocked<PrismaService>;
  let service: Record<string, jest.Mock>;
  const search = jest.fn();

  function arrange(s: Scenario, opts: { archived?: boolean } = {}) {
    m(prisma.user.findUnique).mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          isSystemAdmin: where.id === ACTOR && s.admin === true,
        }),
    );
    m(prisma.document.findUnique).mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === DOC
            ? {
                id: DOC,
                spaceId: SPACE,
                isArchived: opts.archived === true,
                members: s.docRole ? [{ userId: ACTOR, role: s.docRole }] : [],
                space: {
                  name: 'Space',
                  members: s.spaceRole
                    ? [{ userId: ACTOR, role: s.spaceRole }]
                    : [],
                },
              }
            : null,
        ),
    );
    m(prisma.spaceMember.findUnique).mockResolvedValue(
      s.spaceRole ? { userId: ACTOR, spaceId: SPACE, role: s.spaceRole } : null,
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
    search.mockReset().mockResolvedValue([]);
    service.findRecent = jest.fn().mockResolvedValue([]);
    service.getKnowledgeGraph = jest
      .fn()
      .mockResolvedValue({ nodes: [], links: [], truncated: false });

    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        RoleGuard,
        PermissionService,
        { provide: PrismaService, useValue: prisma },
        { provide: DocumentService, useValue: service },
        { provide: SearchService, useValue: { search } },
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

  describe.each(SCENARIOS.map((s, i) => [s.label, s, i] as const))(
    'actor: %s',
    (_label, scenario, column) => {
      it.each(ROUTES.map((r) => [r.name, r] as const))(
        '%s',
        async (_n, route) => {
          arrange(scenario);
          const res = await send(route);

          if (route.allowed[column]) {
            expect(res.status).toBe(route.ok);
            expect(service[route.handler]).toHaveBeenCalledTimes(1);
          } else {
            expect(res.status).toBe(403);
            expect(service[route.handler]).not.toHaveBeenCalled();
          }
        },
      );
    },
  );

  describe('routes without a resource id are JWT-only', () => {
    const open = [
      ['GET /document/recent', '/document/recent'],
      ['GET /document/graph', '/document/graph'],
      ['GET /document/search?q=x', '/document/search?q=x'],
    ];

    it.each(open)(
      '%s passes for a non-member without touching the database',
      async (_n, path) => {
        arrange(SCENARIOS[3]);
        const res = await send({ method: 'get', path });
        expect(res.status).toBe(200);
        expect(prisma.document.findUnique).not.toHaveBeenCalled();
        expect(prisma.spaceMember.findUnique).not.toHaveBeenCalled();
      },
    );

    it.each(open)('%s needs a token (401)', async (_n, path) => {
      const res = await send({ method: 'get', path }, '');
      expect(res.status).toBe(401);
    });
  });

  it.each(ROUTES.map((r) => [r.name, r] as const))(
    '%s needs a token (401) and never reaches the service',
    async (_n, route) => {
      arrange(SCENARIOS[0]);
      const res = await send(route, '');
      expect(res.status).toBe(401);
      expect(service[route.handler]).not.toHaveBeenCalled();
    },
  );

  describe('archived documents (the trash)', () => {
    const live = ROUTES.filter(
      (r) => r.name !== 'DELETE /document/:id' && !r.name.includes('(space'),
    );

    it.each(live.map((r) => [r.name, r] as const))(
      '%s -> 404 for everyone, admin and OWNER included',
      async (_n, route) => {
        for (const scenario of SCENARIOS) {
          arrange(scenario, { archived: true });
          const res = await send(route);
          expect(res.status).toBe(404);
        }
        expect(service[route.handler]).not.toHaveBeenCalled();
      },
    );

    it('DELETE /document/:id: OWNERs (and admins) may hard-delete from the trash, others get 403', async () => {
      const del = ROUTES.find((r) => r.name === 'DELETE /document/:id')!;
      for (const [column, scenario] of SCENARIOS.entries()) {
        service.remove.mockClear();
        arrange(scenario, { archived: true });
        const res = await send(del);
        expect(res.status).toBe(OWNER[column] ? 200 : 403);
        expect(service.remove).toHaveBeenCalledTimes(OWNER[column] ? 1 : 0);
      }
    });
  });

  describe('failure modes before the service', () => {
    it.each(
      ROUTES.filter((r) => r.path.includes(DOC)).map(
        (r) => [r.name, r] as const,
      ),
    )('%s -> 404 for a document that does not exist', async (_n, route) => {
      arrange(SCENARIOS[0]);
      m(prisma.document.findUnique).mockResolvedValue(null);
      const res = await send(route);
      expect(res.status).toBe(404);
      expect(service[route.handler]).not.toHaveBeenCalled();
    });

    it('a malformed id is a 400 (not 403/404/500) and never queries the database', async () => {
      arrange(SCENARIOS[0]);
      const res = await send({ method: 'get', path: '/document/not-a-uuid' });
      expect(res.status).toBe(400);
      expect(prisma.document.findUnique).not.toHaveBeenCalled();
    });

    it('create: a missing or malformed spaceId is a 400', async () => {
      arrange(SCENARIOS[0]);
      for (const body of [{ title: 'T' }, { spaceId: 'x', title: 'T' }]) {
        const res = await send({ method: 'post', path: '/document', body });
        expect(res.status).toBe(400);
      }
      expect(service.create).not.toHaveBeenCalled();
    });

    it('authorization runs before body validation: a viewer sending an invalid body gets 403', async () => {
      arrange(SCENARIOS[2]);
      const res = await send({
        method: 'patch',
        path: `/document/${DOC}`,
        body: { title: '' },
      });
      expect(res.status).toBe(403);
    });

    it('an authorized caller with an invalid body still gets the validation 400', async () => {
      arrange(SCENARIOS[1]);
      const res = await send({
        method: 'patch',
        path: `/document/${DOC}`,
        body: { title: '' },
      });
      expect(res.status).toBe(400);
      expect(service.update).not.toHaveBeenCalled();
    });
  });

  describe('database round-trips of GET /document/:id', () => {
    it('guard + service check share one document read and one admin flag read per request', async () => {
      arrange(SCENARIOS[1]);
      // The real service would call assertDocumentRole again; simulate that second check.
      const permissions = app.get(PermissionService);
      service.findOne.mockImplementation(async (id: string, userId: string) => {
        await permissions.assertDocumentRole(userId, id, Role.VIEWER);
        return { id };
      });

      const res = await send({ method: 'get', path: `/document/${DOC}` });

      expect(res.status).toBe(200);
      expect(prisma.document.findUnique).toHaveBeenCalledTimes(1);
      // FakeJwtGuard does not read the user row; the one read is PermissionService's own.
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
