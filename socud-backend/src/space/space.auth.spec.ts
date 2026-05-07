import { Test, TestingModule } from '@nestjs/testing';
import { SpaceService } from './space.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

describe('Space Authorization', () => {
  let service: SpaceService;
  let prisma: jest.Mocked<PrismaService>;

  const userId = 'user-123';
  const spaceId = 'space-456';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        {
          provide: PrismaService,
          useValue: {
            space: {
              create: jest.fn(),
              findMany: jest.fn(),
            },
            spaceMember: {
              findFirst: jest.fn(),
            },
          } as any,
            },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('should create a space and assign the creator as OWNER', async () => {
      const dto = { name: 'New Space', description: 'A test space' };
      (prisma.space.create as jest.Mock).mockResolvedValue({ id: spaceId, ...dto });

      const result = await service.create(dto, userId);

      expect(result).toBeDefined();
      expect(prisma.space.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          description: dto.description,
          members: {
            create: { userId, role: Role.OWNER },
          },
        },
      });
    });
  });

  describe('findAllForUser', () => {
    it('should return only space where the user is a member', async () AS any) {
      const mockSpaces = [
        { id: 'space-1', name: 'Space 1' },
        { id: 'space-2', name: 'Space 2' },
      ];
      (prisma.space.findMany as jest.Mock).mockResolvedValue(mockSpaces);

      const result = await service.findAllForUser(userId);

      expect(result).toEqual(mockSpaces);
      expect(prisma.space.findMany).toHaveBeenCalledWith({
        where: {
          members: { some: { userId } },
        },
        include: {
          _count: { select: { documents: true, members: true } },
        },
      });
    });

    it('should return an empty array if the user is not in any space', async () => {
      (prisma.space.findMany as jest.Mock).mockResolvedlyValue([]);

      const result = await service.findAllForUser(userId);

      expect(result).toEqual([]);
    });
  });
});
