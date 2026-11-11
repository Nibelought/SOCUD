import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SpaceService } from './space.service';
import { PermissionService } from '../permission/permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaServiceMock } from '../test-utils/mocks';

const m = (fn: unknown) => fn as jest.Mock;

describe('SpaceService', () => {
  let service: SpaceService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        PermissionService,
        { provide: PrismaService, useValue: createPrismaServiceMock() },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
    prisma = module.get(PrismaService);
    m(prisma.$transaction).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
    m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: true });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('restoreSpace', () => {
    const archivedAt = new Date('2026-01-01T10:00:00.000Z');

    it('restores the space and counts the documents archived with it', async () => {
      m(prisma.space.findUnique).mockResolvedValue({
        isArchived: true,
        archivedAt,
      });
      m(prisma.document.updateMany).mockResolvedValue({ count: 3 });

      await expect(service.restoreSpace('space', 'user')).resolves.toEqual({
        restored: 3,
      });

      expect(prisma.space.update).toHaveBeenCalledWith({
        where: { id: 'space' },
        data: { isArchived: false, archivedAt: null },
      });
      expect(prisma.document.updateMany).toHaveBeenCalledWith({
        where: { spaceId: 'space', isArchived: true, archivedAt },
        data: { isArchived: false, archivedAt: null },
      });
    });

    it('restores 0 documents when the space has no archive timestamp', async () => {
      m(prisma.space.findUnique).mockResolvedValue({
        isArchived: true,
        archivedAt: null,
      });
      await expect(service.restoreSpace('space', 'user')).resolves.toEqual({
        restored: 0,
      });
      expect(prisma.space.update).toHaveBeenCalled();
      expect(prisma.document.updateMany).not.toHaveBeenCalled();
    });

    it('409 when the space is not archived, without writing', async () => {
      m(prisma.space.findUnique).mockResolvedValue({
        isArchived: false,
        archivedAt: null,
      });
      await expect(service.restoreSpace('space', 'user')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.space.update).not.toHaveBeenCalled();
      expect(prisma.document.updateMany).not.toHaveBeenCalled();
    });

    it('404 for a space that does not exist (admin)', async () => {
      m(prisma.space.findUnique).mockResolvedValue(null);
      await expect(service.restoreSpace('space', 'user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
