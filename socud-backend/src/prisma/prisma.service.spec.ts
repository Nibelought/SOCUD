import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { createConfigServiceMock } from '../test-utils/mocks';

describe('PrismaService', () => {
  let service: PrismaService;
  let config: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    config = createConfigServiceMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, { provide: ConfigService, useValue: config }],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    // The pg Pool connects lazily, so no database is needed to close it.
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reads the connection string from ConfigService', () => {
    expect(config.getOrThrow).toHaveBeenCalledWith('DATABASE_URL');
  });
});
