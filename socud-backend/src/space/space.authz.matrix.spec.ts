import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { SpaceService } from './space.service';
import { PermissionService } from '../permission/permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaServiceMock } from '../test-utils/mocks';

const m = (fn: unknown) => fn as jest.Mock;

const ACTOR = 'actor-id';
const TARGET = 'target-id';
const SPACE = 'space-id';

type Actor = 'OWNER' | 'EDITOR' | 'VIEWER' | 'NON_MEMBER' | 'ADMIN';
const ACTORS: Actor[] = ['OWNER', 'EDITOR', 'VIEWER', 'NON_MEMBER', 'ADMIN'];

interface Arrange {
  actor: Actor;
  /** Role of TARGET in the space (undefined = not a member). */
  targetRole?: Role;
  /** Total number of OWNERs in the space. */
  owners?: number;
  targetUserExists?: boolean;
  spaceExists?: boolean;
  /** The space is in the trash (restore needs this; every other endpoint uses a live space). */
  spaceArchived?: boolean;
}

describe('Space authorization matrix', () => {
  let service: SpaceService;
  let prisma: jest.Mocked<PrismaService>;

  /** Every Prisma call that mutates data; denied calls must touch none of them. */
  const writes = () => [
    m(prisma.space.create),
    m(prisma.space.update),
    m(prisma.space.delete),
    m(prisma.spaceMember.create),
    m(prisma.spaceMember.upsert),
    m(prisma.spaceMember.delete),
    m(prisma.document.updateMany),
  ];

  function arrange({
    actor,
    targetRole,
    owners = 2,
    targetUserExists = true,
    spaceExists = true,
    spaceArchived = false,
  }: Arrange) {
    const actorRole = (['OWNER', 'EDITOR', 'VIEWER'] as const).includes(
      actor as 'OWNER',
    )
      ? (actor as Role)
      : undefined;

    m(prisma.user.findUnique).mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === ACTOR
            ? { id: ACTOR, isSystemAdmin: actor === 'ADMIN' }
            : targetUserExists
              ? { id: where.id, isSystemAdmin: false }
              : null,
        ),
    );
    m(prisma.spaceMember.findUnique).mockImplementation(
      ({ where }: { where: { userId_spaceId: { userId: string } } }) => {
        const userId = where.userId_spaceId.userId;
        if (userId === ACTOR && actorRole) {
          return Promise.resolve({ userId, spaceId: SPACE, role: actorRole });
        }
        if (userId === TARGET && targetRole) {
          return Promise.resolve({ userId, spaceId: SPACE, role: targetRole });
        }
        return Promise.resolve(null);
      },
    );
    m(prisma.spaceMember.count).mockResolvedValue(owners);
    m(prisma.spaceMember.findMany).mockResolvedValue([]);
    m(prisma.spaceMember.upsert).mockImplementation(
      ({ create }: { create: object }) => Promise.resolve(create),
    );
    m(prisma.spaceMember.delete).mockResolvedValue({});
    m(prisma.space.findUnique).mockResolvedValue(
      spaceExists
        ? {
            id: SPACE,
            isArchived: spaceArchived,
            archivedAt: new Date(),
            documents: [],
          }
        : null,
    );
    m(prisma.space.update).mockResolvedValue({ id: SPACE });
    m(prisma.space.delete).mockResolvedValue({ id: SPACE });
    m(prisma.document.updateMany).mockResolvedValue({ count: 0 });
    m(prisma.$transaction).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SpaceService,
        PermissionService,
        { provide: PrismaService, useValue: createPrismaServiceMock() },
      ],
    }).compile();
    service = moduleRef.get(SpaceService);
    prisma = moduleRef.get(PrismaService);
  });

  interface Endpoint {
    name: string;
    call: () => Promise<unknown>;
    /** The Prisma mutation that must happen when allowed (null for read-only endpoints). */
    write: (() => jest.Mock) | null;
    /** The Prisma read that proves the call went through (read-only endpoints). */
    read?: () => jest.Mock;
    allowed: Actor[];
    /** Extra arrangement (e.g. target membership) the endpoint needs to succeed. */
    arrange?: Partial<Arrange>;
  }

  const endpoints = (): Endpoint[] => [
    {
      name: 'findOne',
      call: () => service.findOne(SPACE, ACTOR),
      write: null,
      read: () => m(prisma.space.findUnique),
      allowed: ['OWNER', 'EDITOR', 'VIEWER', 'ADMIN'],
    },
    {
      name: 'updateSpace',
      call: () => service.updateSpace(SPACE, ACTOR, { title: ' New name ' }),
      write: () => m(prisma.space.update),
      allowed: ['OWNER', 'EDITOR', 'ADMIN'],
    },
    {
      name: 'archiveSpace',
      call: () => service.archiveSpace(SPACE, ACTOR),
      write: () => m(prisma.space.update),
      allowed: ['OWNER', 'ADMIN'],
    },
    {
      name: 'removeSpace',
      call: () => service.removeSpace(SPACE, ACTOR),
      write: () => m(prisma.space.delete),
      allowed: ['OWNER', 'ADMIN'],
    },
    {
      name: 'restoreSpace',
      call: () => service.restoreSpace(SPACE, ACTOR),
      write: () => m(prisma.space.update),
      allowed: ['OWNER', 'ADMIN'],
      arrange: { spaceArchived: true },
    },
    {
      name: 'getMembers',
      call: () => service.getMembers(SPACE, ACTOR),
      write: null,
      read: () => m(prisma.spaceMember.findMany),
      allowed: ['OWNER', 'EDITOR', 'VIEWER', 'ADMIN'],
    },
    {
      name: 'upsertMember (add new member)',
      call: () =>
        service.upsertMember(SPACE, ACTOR, {
          userId: TARGET,
          role: Role.VIEWER,
        }),
      write: () => m(prisma.spaceMember.upsert),
      allowed: ['OWNER', 'ADMIN'],
    },
    {
      name: 'upsertMember (promote to OWNER)',
      call: () =>
        service.upsertMember(SPACE, ACTOR, {
          userId: TARGET,
          role: Role.OWNER,
        }),
      write: () => m(prisma.spaceMember.upsert),
      allowed: ['OWNER', 'ADMIN'],
      arrange: { targetRole: Role.EDITOR },
    },
    {
      name: 'removeMember',
      call: () => service.removeMember(SPACE, ACTOR, TARGET),
      write: () => m(prisma.spaceMember.delete),
      allowed: ['OWNER', 'ADMIN'],
      arrange: { targetRole: Role.VIEWER },
    },
  ];

  describe.each(ACTORS)('actor: %s', (actor) => {
    // The endpoint list is rebuilt lazily, so the table is generated per actor at run time.
    const names = [
      'findOne',
      'updateSpace',
      'archiveSpace',
      'removeSpace',
      'restoreSpace',
      'getMembers',
      'upsertMember (add new member)',
      'upsertMember (promote to OWNER)',
      'removeMember',
    ];

    it.each(names)('%s', async (name) => {
      const endpoint = endpoints().find((e) => e.name === name)!;
      arrange({ actor, ...endpoint.arrange });
      const isAllowed = endpoint.allowed.includes(actor);

      if (isAllowed) {
        await expect(endpoint.call()).resolves.toBeDefined();
        if (endpoint.write) expect(endpoint.write()).toHaveBeenCalled();
        if (endpoint.read) expect(endpoint.read()).toHaveBeenCalled();
      } else {
        await expect(endpoint.call()).rejects.toThrow(ForbiddenException);
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
        if (endpoint.read) expect(endpoint.read()).not.toHaveBeenCalled();
      }
    });
  });

  describe('updateSpace input mapping', () => {
    it('maps title to name explicitly and trims it', async () => {
      arrange({ actor: 'OWNER' });
      await service.updateSpace(SPACE, ACTOR, {
        title: '  Docs  ',
        description: 'd',
      });
      expect(prisma.space.update).toHaveBeenCalledWith({
        where: { id: SPACE },
        data: { name: 'Docs', description: 'd' },
      });
    });
  });

  describe('member routes: existence checks', () => {
    it('returns 404 when a system admin targets a space that does not exist', async () => {
      arrange({ actor: 'ADMIN', spaceExists: false });
      await expect(service.getMembers(SPACE, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.upsertMember(SPACE, ACTOR, {
          userId: TARGET,
          role: Role.VIEWER,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.spaceMember.upsert).not.toHaveBeenCalled();
    });

    it('returns 404 when the target user does not exist and does not write', async () => {
      arrange({ actor: 'OWNER', targetUserExists: false });
      await expect(
        service.upsertMember(SPACE, ACTOR, {
          userId: TARGET,
          role: Role.EDITOR,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.spaceMember.upsert).not.toHaveBeenCalled();
    });

    it('returns 404 when removing someone who is not a member', async () => {
      arrange({ actor: 'OWNER' });
      await expect(service.removeMember(SPACE, ACTOR, TARGET)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.spaceMember.delete).not.toHaveBeenCalled();
    });

    it('does not reveal whether a space exists to a non-member', async () => {
      arrange({ actor: 'NON_MEMBER', spaceExists: false });
      await expect(service.getMembers(SPACE, ACTOR)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('last-OWNER guard', () => {
    it('refuses to remove the last OWNER (409) without deleting', async () => {
      arrange({ actor: 'OWNER', targetRole: Role.OWNER, owners: 1 });
      const call = service.removeMember(SPACE, ACTOR, TARGET);
      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow(/last OWNER/);
      expect(prisma.spaceMember.delete).not.toHaveBeenCalled();
    });

    it('refuses to demote the last OWNER (409) without writing', async () => {
      arrange({ actor: 'OWNER', targetRole: Role.OWNER, owners: 1 });
      const call = service.upsertMember(SPACE, ACTOR, {
        userId: TARGET,
        role: Role.EDITOR,
      });
      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow(/last OWNER/);
      expect(prisma.spaceMember.upsert).not.toHaveBeenCalled();
    });

    it('applies to system admins too', async () => {
      arrange({ actor: 'ADMIN', targetRole: Role.OWNER, owners: 1 });
      await expect(service.removeMember(SPACE, ACTOR, TARGET)).rejects.toThrow(
        ConflictException,
      );
    });

    it('allows removing an OWNER when another OWNER remains', async () => {
      arrange({ actor: 'OWNER', targetRole: Role.OWNER, owners: 2 });
      await expect(service.removeMember(SPACE, ACTOR, TARGET)).resolves.toEqual(
        { success: true },
      );
      expect(prisma.spaceMember.delete).toHaveBeenCalledTimes(1);
    });

    it('allows demoting an OWNER when another OWNER remains', async () => {
      arrange({ actor: 'OWNER', targetRole: Role.OWNER, owners: 2 });
      await service.upsertMember(SPACE, ACTOR, {
        userId: TARGET,
        role: Role.VIEWER,
      });
      expect(prisma.spaceMember.upsert).toHaveBeenCalledWith({
        where: { userId_spaceId: { userId: TARGET, spaceId: SPACE } },
        update: { role: Role.VIEWER },
        create: { userId: TARGET, spaceId: SPACE, role: Role.VIEWER },
      });
    });

    it('does not count owners when re-affirming OWNER or demoting a non-owner', async () => {
      arrange({ actor: 'OWNER', targetRole: Role.OWNER, owners: 1 });
      await service.upsertMember(SPACE, ACTOR, {
        userId: TARGET,
        role: Role.OWNER,
      });
      expect(prisma.spaceMember.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.spaceMember.count).not.toHaveBeenCalled();
    });

    it('runs membership changes in a serializable transaction', async () => {
      arrange({ actor: 'OWNER', targetRole: Role.VIEWER });
      await service.removeMember(SPACE, ACTOR, TARGET);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    });
  });
});
