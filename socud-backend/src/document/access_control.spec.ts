import { Test, TestingModule } from '@nestjs/testing';
import { DocumentService } from './document.service';
import { PermissionService } from '../permission/permission.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createConfigServiceMock } from '../test-utils/mocks';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CreateDocumentDto, UpdateDocumentDto } from './dto/document.dto';

describe('DocumentService Access Control', () => {
  let service: DocumentService;
  let permissions: PermissionService;

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    spaceMember: { findUnique: jest.fn() },
    document: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    documentMember: { upsert: jest.fn(), delete: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        PermissionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: createConfigServiceMock() },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    permissions = module.get(PermissionService);
    jest.resetAllMocks();
  });

  // Helper that builds a mock document
  const mockDocumentResult = (
    spaceRole?: Role,
    docRole?: Role,
    isArchived = false,
  ) => ({
    id: 'doc-uuid',
    spaceId: 'space-uuid',
    title: 'Test Doc',
    isArchived,
    members: docRole ? [{ role: docRole }] : [],
    space: {
      members: spaceRole ? [{ role: spaceRole }] : [],
    },
  });

  describe('Read Access (findOne - requires OWNER, EDITOR, or VIEWER)', () => {
    it('should allow access if user is Space OWNER (inherits access)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(Role.OWNER),
      );

      const result = await service.findOne('doc-uuid', 'user-uuid');
      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('members'); // destructuring must not leak members
    });

    it('should throw NotFoundException if document does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('invalid-uuid', 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user has no access at all', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(undefined, undefined),
      );

      await expect(service.findOne('doc-uuid', 'user-uuid')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('Write Access & Role Conflicts (update - requires OWNER or EDITOR)', () => {
    const updateDto: UpdateDocumentDto = { title: '  Updated ' };

    it('should allow update if user is Space EDITOR', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(Role.EDITOR),
      );
      mockPrisma.document.update.mockResolvedValue({
        id: 'doc-uuid',
        title: 'Updated',
      });

      const result = await service.update('doc-uuid', 'user-uuid', updateDto);
      expect(result.title).toEqual('Updated');
      expect(mockPrisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-uuid' },
        data: { title: 'Updated', updatedBy: 'user-uuid' },
      });
    });

    it('should DENY update if user is Space VIEWER (Insufficient Space role)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(Role.VIEWER),
      );

      await expect(
        service.update('doc-uuid', 'user-uuid', updateDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('ROLE ESCALATION: should ALLOW update if user is Space VIEWER but has Document EDITOR override', async () => {
      // VIEWER in the space, but granted EDITOR on this document specifically
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(Role.VIEWER, Role.EDITOR),
      );
      mockPrisma.document.update.mockResolvedValue({
        id: 'doc-uuid',
        title: 'Updated',
      });

      const result = await service.update('doc-uuid', 'user-uuid', updateDto);
      expect(result).toBeDefined();
    });

    it('ROLE DEMOTION: should DENY update if user is Space EDITOR but has Document VIEWER override', async () => {
      // EDITOR in the space, but restricted to VIEWER on this document specifically
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(Role.EDITOR, Role.VIEWER),
      );

      await expect(
        service.update('doc-uuid', 'user-uuid', updateDto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Creation Access (create - requires Space OWNER or EDITOR)', () => {
    const createDto: CreateDocumentDto = {
      spaceId: 'space-uuid',
      title: 'New Doc',
    };

    it('should allow creation if user is Space EDITOR', async () => {
      mockPrisma.spaceMember.findUnique.mockResolvedValue({
        role: Role.EDITOR,
      });
      mockPrisma.document.create.mockResolvedValue({ id: 'new-doc' });

      const result = await service.create(createDto, 'user-uuid');
      expect(result).toBeDefined();
    });

    it('should throw ForbiddenException if user is Space VIEWER', async () => {
      mockPrisma.spaceMember.findUnique.mockResolvedValue({
        role: Role.VIEWER,
      });

      await expect(service.create(createDto, 'user-uuid')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // =====================================================================
  // Core requirements: isArchived and isSystemAdmin behaviour
  // =====================================================================
  describe('TDD: Missing Core Features (Phase 1 Requirements)', () => {
    // Rule: an archived document is in the trash and returns 404 for everyone,
    // including space OWNERs and system admins.
    it('should throw NotFoundException if document isArchived (Soft Delete)', async () => {
      // The document exists and the user is OWNER, but the document is archived
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(Role.OWNER, undefined, true),
      );

      await expect(service.findOne('doc-uuid', 'user-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for an archived document even for a space OWNER on write paths', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(Role.OWNER, undefined, true),
      );

      await expect(
        service.update('doc-uuid', 'user-uuid', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.document.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for an archived document even for a system admin', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(undefined, undefined, true),
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-uuid',
        isSystemAdmin: true,
      });

      await expect(
        permissions.assertDocumentRole('admin-uuid', 'doc-uuid', Role.VIEWER),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow FULL access if user isSystemAdmin, even without Space/Document roles', async () => {
      // Document without any grants (empty members)
      mockPrisma.document.findUnique.mockResolvedValue(
        mockDocumentResult(undefined, undefined, false),
      );
      // Simulate Prisma returning isSystemAdmin: true
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin-uuid',
        isSystemAdmin: true,
      });

      const result = await service.findOne('doc-uuid', 'admin-uuid');
      expect(result).toBeDefined();
    });
  });
});
