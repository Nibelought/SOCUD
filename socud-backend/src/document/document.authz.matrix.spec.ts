import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { DocumentService } from './document.service';
import { PermissionService } from '../permission/permission.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createConfigServiceMock,
  createPrismaServiceMock,
} from '../test-utils/mocks';

const m = (fn: unknown) => fn as jest.Mock;

const ACTOR = 'actor-id';
const TARGET = 'target-id';
const DOC = 'doc-id';
const SPACE = 'space-id';

interface Scenario {
  label: string;
  spaceRole?: Role;
  docRole?: Role;
  admin?: boolean;
}

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

/**
 * Columns follow SCENARIOS order:
 * sOWN sEDT sVWR none ADMIN vwr+dE edt+dV vwr+dO none+dE
 */
type Row = [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
];

const READ: Row = [true, true, true, false, true, true, true, true, true];
const WRITE: Row = [true, true, false, false, true, true, false, true, true];
const OWNER_ONLY: Row = [
  true,
  false,
  false,
  false,
  true,
  false,
  false,
  true,
  false,
];

describe('Document authorization matrix', () => {
  let service: DocumentService;
  let prisma: jest.Mocked<PrismaService>;

  const writes = () => [
    m(prisma.document.create),
    m(prisma.document.update),
    m(prisma.document.updateMany),
    m(prisma.document.delete),
    m(prisma.documentMember.upsert),
    m(prisma.documentMember.delete),
    m(prisma.documentChunk.deleteMany),
    m(prisma.documentLink.deleteMany),
    m(prisma.documentLink.createMany),
    m(prisma.$transaction),
  ];

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
        where.id === DOC
          ? Promise.resolve({
              id: DOC,
              spaceId: SPACE,
              title: 'Doc',
              contentHtml: '<p>x</p>',
              updatedAt: new Date(),
              isArchived: opts.archived === true,
              members: s.docRole ? [{ userId: ACTOR, role: s.docRole }] : [],
              space: {
                name: 'Space',
                members: s.spaceRole
                  ? [
                      {
                        userId: ACTOR,
                        role: s.spaceRole,
                        user: { id: ACTOR, email: 'a@b.c' },
                      },
                    ]
                  : [],
              },
            })
          : Promise.resolve(null),
    );
    m(prisma.spaceMember.findUnique).mockResolvedValue(
      s.spaceRole ? { userId: ACTOR, spaceId: SPACE, role: s.spaceRole } : null,
    );
    m(prisma.document.create).mockResolvedValue({ id: 'new' });
    m(prisma.document.update).mockResolvedValue({
      id: DOC,
      title: 'Doc',
      publishedVersion: 1,
    });
    m(prisma.document.updateMany).mockResolvedValue({ count: 0 });
    m(prisma.document.delete).mockResolvedValue({ id: DOC });
    m(prisma.documentMember.upsert).mockResolvedValue({});
    m(prisma.documentMember.delete).mockResolvedValue({});
    m(prisma.$transaction).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentService,
        PermissionService,
        { provide: PrismaService, useValue: createPrismaServiceMock() },
        { provide: ConfigService, useValue: createConfigServiceMock() },
      ],
    }).compile();
    service = moduleRef.get(DocumentService);
    prisma = moduleRef.get(PrismaService);
  });

  interface Endpoint {
    name: string;
    call: () => Promise<unknown>;
    /** Mutation that must run when allowed; null for read-only endpoints. */
    write: (() => jest.Mock) | null;
    allowed: Row;
    /** The document must be in the trash for the call to succeed (restore). */
    archived?: boolean;
  }

  const endpoints = (): Endpoint[] => [
    {
      name: 'findOne',
      call: () => service.findOne(DOC, ACTOR),
      write: null,
      allowed: READ,
    },
    {
      name: 'getMembersWithInheritance',
      call: () => service.getMembersWithInheritance(DOC, ACTOR),
      write: null,
      allowed: READ,
    },
    {
      name: 'update',
      call: () => service.update(DOC, ACTOR, { title: 'T' }),
      write: () => m(prisma.document.update),
      allowed: WRITE,
    },
    {
      name: 'publishDocument',
      call: () => service.publishDocument(DOC, ACTOR, { html: '<p>ok</p>' }),
      write: () => m(prisma.document.update),
      allowed: WRITE,
    },
    {
      name: 'archive',
      call: () => service.archive(DOC, ACTOR),
      write: () => m(prisma.document.update),
      allowed: OWNER_ONLY,
    },
    {
      name: 'upsertDocumentMember',
      call: () =>
        service.upsertDocumentMember(DOC, ACTOR, {
          userId: TARGET,
          role: Role.EDITOR,
        }),
      write: () => m(prisma.documentMember.upsert),
      allowed: OWNER_ONLY,
    },
    {
      name: 'removeDocumentMember',
      call: () => service.removeDocumentMember(DOC, ACTOR, TARGET),
      write: () => m(prisma.documentMember.delete),
      allowed: OWNER_ONLY,
    },
    {
      name: 'remove (hard delete)',
      call: () => service.remove(DOC, ACTOR),
      write: () => m(prisma.document.delete),
      allowed: OWNER_ONLY,
    },
    {
      name: 'restoreDocument',
      call: () => service.restoreDocument(DOC, ACTOR),
      write: () => m(prisma.document.update),
      allowed: OWNER_ONLY,
      archived: true,
    },
  ];

  const names = [
    'findOne',
    'getMembersWithInheritance',
    'update',
    'publishDocument',
    'archive',
    'upsertDocumentMember',
    'removeDocumentMember',
    'remove (hard delete)',
    'restoreDocument',
  ];

  describe.each(SCENARIOS.map((s, i) => [s.label, s, i] as const))(
    'actor: %s',
    (_label, scenario, column) => {
      it.each(names)('%s', async (name) => {
        const endpoint = endpoints().find((e) => e.name === name)!;
        arrange(scenario, { archived: endpoint.archived });

        if (endpoint.allowed[column]) {
          await expect(endpoint.call()).resolves.toBeDefined();
          if (endpoint.write) expect(endpoint.write()).toHaveBeenCalled();
        } else {
          await expect(endpoint.call()).rejects.toThrow(ForbiddenException);
          writes().forEach((write) => expect(write).not.toHaveBeenCalled());
        }
      });
    },
  );

  describe('archived documents are in the trash', () => {
    const everyone = SCENARIOS.map((s) => [s.label, s] as const);
    const viaVerify = names.filter(
      (n) => n !== 'remove (hard delete)' && n !== 'restoreDocument',
    );

    describe.each(everyone)('actor: %s', (_label, scenario) => {
      it.each(viaVerify)('%s -> 404 without writing', async (name) => {
        const endpoint = endpoints().find((e) => e.name === name)!;
        arrange(scenario, { archived: true });

        await expect(endpoint.call()).rejects.toThrow(NotFoundException);
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      });
    });

    it.each([
      ['space OWNER', SCENARIOS[0]],
      ['system admin', SCENARIOS[4]],
      ['document OWNER override', SCENARIOS[7]],
    ])('%s can still restore and hard-delete', async (_l, scenario) => {
      arrange(scenario, { archived: true });
      await service.restoreDocument(DOC, ACTOR);
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: DOC },
        data: { isArchived: false, archivedAt: null },
      });
      await service.remove(DOC, ACTOR);
      expect(prisma.document.delete).toHaveBeenCalledWith({
        where: { id: DOC },
      });
    });

    it.each([
      ['space EDITOR', SCENARIOS[1]],
      ['space VIEWER', SCENARIOS[2]],
      ['non-member', SCENARIOS[3]],
    ])('%s cannot restore or hard-delete', async (_l, scenario) => {
      arrange(scenario, { archived: true });
      await expect(service.restoreDocument(DOC, ACTOR)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.remove(DOC, ACTOR)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.document.update).not.toHaveBeenCalled();
      expect(prisma.document.delete).not.toHaveBeenCalled();
    });
  });

  describe('nonexistent document', () => {
    it.each(names)('%s -> 404', async (name) => {
      arrange(SCENARIOS[0]);
      m(prisma.document.findUnique).mockResolvedValue(null);
      const endpoint = endpoints().find((e) => e.name === name)!;
      await expect(endpoint.call()).rejects.toThrow(NotFoundException);
      writes().forEach((write) => expect(write).not.toHaveBeenCalled());
    });
  });

  describe('update (PATCH /document/:id) writes only the title', () => {
    it('maps fields explicitly, ignoring anything else on the DTO object', async () => {
      arrange(SCENARIOS[1]);
      const hostile = {
        title: '  New title ',
        spaceId: 'other',
        createdBy: 'other',
        contentHtml: '<script>',
        isArchived: true,
        parentId: 'x',
      };
      await service.update(DOC, ACTOR, hostile);
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: DOC },
        data: { title: 'New title', updatedBy: ACTOR },
      });
    });
  });

  describe('upsertDocumentMember', () => {
    it('returns 404 for an unknown target user without writing', async () => {
      arrange(SCENARIOS[0]);
      m(prisma.user.findUnique).mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === ACTOR ? { id: ACTOR, isSystemAdmin: false } : null,
          ),
      );
      await expect(
        service.upsertDocumentMember(DOC, ACTOR, {
          userId: TARGET,
          role: Role.EDITOR,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.documentMember.upsert).not.toHaveBeenCalled();
    });
  });

  describe('create (POST /document)', () => {
    const dto = { spaceId: SPACE, title: 'T' };

    it.each([
      ['space OWNER', SCENARIOS[0], true],
      ['space EDITOR', SCENARIOS[1], true],
      ['space VIEWER', SCENARIOS[2], false],
      ['non-member', SCENARIOS[3], false],
      ['system admin', SCENARIOS[4], true],
    ] as const)('%s -> allowed: %s', async (_l, scenario, allowed) => {
      arrange(scenario);
      if (allowed) {
        await service.create(dto, ACTOR);
        expect(prisma.document.create).toHaveBeenCalledWith({
          data: {
            title: 'T',
            spaceId: SPACE,
            parentId: undefined,
            createdBy: ACTOR,
          },
        });
      } else {
        await expect(service.create(dto, ACTOR)).rejects.toThrow(
          ForbiddenException,
        );
        expect(prisma.document.create).not.toHaveBeenCalled();
      }
    });

    describe('parentId validation (S16)', () => {
      const parentId = 'parent-id';
      const withParent = (parent: object | null) => {
        arrange(SCENARIOS[1]);
        const base = m(prisma.document.findUnique).getMockImplementation()!;
        m(prisma.document.findUnique).mockImplementation(
          (args: { where: { id: string } }) =>
            args.where.id === parentId ? Promise.resolve(parent) : base(args),
        );
      };

      it('accepts a live parent in the same space', async () => {
        withParent({ spaceId: SPACE, isArchived: false });
        await service.create({ ...dto, parentId }, ACTOR);
        expect(prisma.document.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ parentId }) as unknown,
        });
      });

      it.each([
        ['does not exist', null],
        ['is in another space', { spaceId: 'other-space', isArchived: false }],
        ['is archived', { spaceId: SPACE, isArchived: true }],
      ])('rejects a parent that %s with 400', async (_l, parent) => {
        withParent(parent);
        await expect(
          service.create({ ...dto, parentId }, ACTOR),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.document.create).not.toHaveBeenCalled();
      });

      it('checks space permission before looking at the parent', async () => {
        arrange(SCENARIOS[2]);
        await expect(
          service.create({ ...dto, parentId }, ACTOR),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.document.findUnique).not.toHaveBeenCalled();
      });
    });
  });

  describe('list endpoints are scoped to the caller', () => {
    it('findRecent and graph filter by membership for normal users', async () => {
      arrange(SCENARIOS[2]);
      m(prisma.document.findMany).mockResolvedValue([]);
      m(prisma.documentLink.findMany).mockResolvedValue([]);

      await service.findRecent(ACTOR);
      await service.getKnowledgeGraph(ACTOR);

      const scoped = {
        isArchived: false,
        OR: [
          { space: { members: { some: { userId: ACTOR } } } },
          { members: { some: { userId: ACTOR } } },
        ],
      };
      for (const call of m(prisma.document.findMany).mock.calls) {
        expect((call[0] as { where: unknown }).where).toEqual(scoped);
      }
      expect(m(prisma.document.findMany)).toHaveBeenCalledTimes(2);
    });

    it('admins only get the isArchived filter', async () => {
      arrange(SCENARIOS[4]);
      m(prisma.document.findMany).mockResolvedValue([]);
      await service.findRecent(ACTOR);
      expect(
        (m(prisma.document.findMany).mock.calls[0][0] as { where: unknown })
          .where,
      ).toEqual({ isArchived: false });
    });
  });
});
