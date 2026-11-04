import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from './document.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createConfigServiceMock,
  createPrismaServiceMock,
} from '../test-utils/mocks';

describe('DocumentService', () => {
  let service: DocumentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: PrismaService, useValue: createPrismaServiceMock() },
        { provide: ConfigService, useValue: createConfigServiceMock() },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
