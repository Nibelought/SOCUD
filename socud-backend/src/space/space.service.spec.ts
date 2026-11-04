import { Test, TestingModule } from '@nestjs/testing';
import { SpaceService } from './space.service';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaServiceMock } from '../test-utils/mocks';

describe('SpaceService', () => {
  let service: SpaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: PrismaService, useValue: createPrismaServiceMock() },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
