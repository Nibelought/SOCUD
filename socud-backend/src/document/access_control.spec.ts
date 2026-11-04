import { Test, TestingModule } from '@nestjs/testing';
import { DocumentService } from './document.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CreateDocumentDto, UpdateDocumentDto } from './dto/document.dto';

describe('DocumentService Access Control', () => {
  let service: DocumentService;
  let prisma: PrismaService;

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    spaceMember: { findUnique: jest.fn() },
    document: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    documentMember: { upsert: jest.fn(), delete: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  // Вспомогательная функция для генерации мока документа
  const mockDocumentResult = (spaceRole?: Role, docRole?: Role, isArchived = false) => ({
    id: 'doc-uuid',
    spaceId: 'space-uuid',
    title: 'Test Doc',
    isArchived,
    members: docRole ? [{ role: docRole }] :[],
    space: {
      members: spaceRole ? [{ role: spaceRole }] :[],
    },
  });

  describe('Read Access (findOne - requires OWNER, EDITOR, or VIEWER)', () => {
    it('should allow access if user is Space OWNER (inherits access)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(mockDocumentResult(Role.OWNER));

      const result = await service.findOne('doc-uuid', 'user-uuid');
      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('members'); // Проверка Clean Code (деструктуризации)
    });

    it('should throw NotFoundException if document does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-uuid', 'user-uuid')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user has no access at all', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(mockDocumentResult(undefined, undefined));

      await expect(service.findOne('doc-uuid', 'user-uuid')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Write Access & Role Conflicts (update - requires OWNER or EDITOR)', () => {
    const updateDto: UpdateDocumentDto = { title: 'Updated' };

    it('should allow update if user is Space EDITOR', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(mockDocumentResult(Role.EDITOR));
      mockPrisma.document.update.mockResolvedValue({ id: 'doc-uuid', title: 'Updated' });

      const result = await service.update('doc-uuid', 'user-uuid', updateDto);
      expect(result.title).toEqual('Updated');
    });

    it('should DENY update if user is Space VIEWER (Insufficient Space role)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(mockDocumentResult(Role.VIEWER));

      await expect(service.update('doc-uuid', 'user-uuid', updateDto)).rejects.toThrow(ForbiddenException);
    });

    it('ROLE ESCALATION: should ALLOW update if user is Space VIEWER but has Document EDITOR override', async () => {
      // Пользователь VIEWER в пространстве, но ему точечно дали EDITOR для этого документа
      mockPrisma.document.findUnique.mockResolvedValue(mockDocumentResult(Role.VIEWER, Role.EDITOR));
      mockPrisma.document.update.mockResolvedValue({ id: 'doc-uuid', title: 'Updated' });

      const result = await service.update('doc-uuid', 'user-uuid', updateDto);
      expect(result).toBeDefined();
    });

    it('ROLE DEMOTION: should DENY update if user is Space EDITOR but has Document VIEWER override', async () => {
      // Пользователь EDITOR в пространстве, но его права точечно урезали до VIEWER для документа
      mockPrisma.document.findUnique.mockResolvedValue(mockDocumentResult(Role.EDITOR, Role.VIEWER));

      await expect(service.update('doc-uuid', 'user-uuid', updateDto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Creation Access (create - requires Space OWNER or EDITOR)', () => {
    const createDto: CreateDocumentDto = { spaceId: 'space-uuid', title: 'New Doc' };

    it('should allow creation if user is Space EDITOR', async () => {
      mockPrisma.spaceMember.findUnique.mockResolvedValue({ role: Role.EDITOR });
      mockPrisma.document.create.mockResolvedValue({ id: 'new-doc' });

      const result = await service.create(createDto, 'user-uuid');
      expect(result).toBeDefined();
    });

    it('should throw ForbiddenException if user is Space VIEWER', async () => {
      mockPrisma.spaceMember.findUnique.mockResolvedValue({ role: Role.VIEWER });

      await expect(service.create(createDto, 'user-uuid')).rejects.toThrow(ForbiddenException);
    });
  });

  // =====================================================================
  // БЛОК TDD: Тесты для фичей, которые заявлены в требованиях (isArchived, isSystemAdmin)
  // Если тесты ниже падают, значит нужно обновить document.service.ts!
  // =====================================================================
  describe('TDD: Missing Core Features (Phase 1 Requirements)', () => {

    it('should throw NotFoundException if document isArchived (Soft Delete)', async () => {
      // Мокаем документ, который существует, пользователь OWNER, но документ в архиве
      mockPrisma.document.findUnique.mockResolvedValue(mockDocumentResult(Role.OWNER, undefined, true));

      await expect(service.findOne('doc-uuid', 'user-uuid')).rejects.toThrow(NotFoundException);
    });

    // РАСКОММЕНТИРУЙТЕ ЭТОТ ТЕСТ, КОГДА ДОБАВИТЕ ЛОГИКУ isSystemAdmin
    it('should allow FULL access if user isSystemAdmin, even without Space/Document roles', async () => {
      // Документ без прав (пустые members)
      mockPrisma.document.findUnique.mockResolvedValue(mockDocumentResult(undefined, undefined, false));
      // Имитируем, что Prisma возвращает флаг isSystemAdmin: true
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'admin-uuid', isSystemAdmin: true });

      const result = await service.findOne('doc-uuid', 'admin-uuid');
      expect(result).toBeDefined();
    });
  });
});