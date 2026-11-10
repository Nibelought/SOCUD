import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  PermissionService,
  ROLE_RANK,
  roleSatisfies,
  rolesAtLeast,
} from './permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaServiceMock } from '../test-utils/mocks';

const m = (fn: unknown) => fn as jest.Mock;

const USER = 'user-id';
const DOC = 'doc-id';
const SPACE = 'space-id';

describe('role ordering', () => {
  it('ranks VIEWER < EDITOR < OWNER', () => {
    expect(ROLE_RANK.VIEWER).toBeLessThan(ROLE_RANK.EDITOR);
    expect(ROLE_RANK.EDITOR).toBeLessThan(ROLE_RANK.OWNER);
  });

  it.each([
    [Role.OWNER, Role.OWNER, true],
    [Role.OWNER, Role.VIEWER, true],
    [Role.EDITOR, Role.EDITOR, true],
    [Role.EDITOR, Role.OWNER, false],
    [Role.VIEWER, Role.EDITOR, false],
    [Role.VIEWER, Role.VIEWER, true],
    [null, Role.VIEWER, false],
    [undefined, Role.VIEWER, false],
  ])('roleSatisfies(%s, %s) = %s', (actual, min, expected) => {
    expect(roleSatisfies(actual, min)).toBe(expected);
  });

  it('lists the satisfying roles strongest first', () => {
    expect(rolesAtLeast(Role.VIEWER)).toEqual(['OWNER', 'EDITOR', 'VIEWER']);
    expect(rolesAtLeast(Role.EDITOR)).toEqual(['OWNER', 'EDITOR']);
    expect(rolesAtLeast(Role.OWNER)).toEqual(['OWNER']);
  });
});

describe('PermissionService', () => {
  let service: PermissionService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = createPrismaServiceMock();
    service = new PermissionService(prisma);
  });

  function arrangeUser(isSystemAdmin: boolean) {
    m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin });
  }

  function arrangeDocument(opts: {
    spaceRole?: Role;
    docRole?: Role;
    archived?: boolean;
    missing?: boolean;
  }) {
    m(prisma.document.findUnique).mockResolvedValue(
      opts.missing
        ? null
        : {
            id: DOC,
            spaceId: SPACE,
            isArchived: opts.archived ?? false,
            members: opts.docRole ? [{ role: opts.docRole }] : [],
            space: {
              members: opts.spaceRole ? [{ role: opts.spaceRole }] : [],
            },
          },
    );
  }

  describe('resolveSpaceRole', () => {
    it.each([Role.OWNER, Role.EDITOR, Role.VIEWER])(
      'returns the membership role (%s)',
      async (role) => {
        arrangeUser(false);
        m(prisma.spaceMember.findUnique).mockResolvedValue({ role });
        await expect(service.resolveSpaceRole(USER, SPACE)).resolves.toBe(role);
      },
    );

    it('returns null for a non-member', async () => {
      arrangeUser(false);
      m(prisma.spaceMember.findUnique).mockResolvedValue(null);
      await expect(service.resolveSpaceRole(USER, SPACE)).resolves.toBeNull();
    });

    it('treats a system admin as OWNER without looking at memberships', async () => {
      arrangeUser(true);
      await expect(service.resolveSpaceRole(USER, SPACE)).resolves.toBe(
        Role.OWNER,
      );
      expect(prisma.spaceMember.findUnique).not.toHaveBeenCalled();
    });

    it('treats an unknown user as a non-member', async () => {
      m(prisma.user.findUnique).mockResolvedValue(null);
      m(prisma.spaceMember.findUnique).mockResolvedValue(null);
      await expect(service.resolveSpaceRole(USER, SPACE)).resolves.toBeNull();
    });
  });

  describe('assertSpaceRole', () => {
    type Case = [string, Role | null, boolean, Role, boolean];
    // [label, membership, admin, min, allowed]
    const cases: Case[] = [
      ['OWNER needs OWNER', Role.OWNER, false, Role.OWNER, true],
      ['EDITOR needs OWNER', Role.EDITOR, false, Role.OWNER, false],
      ['EDITOR needs EDITOR', Role.EDITOR, false, Role.EDITOR, true],
      ['VIEWER needs EDITOR', Role.VIEWER, false, Role.EDITOR, false],
      ['VIEWER needs VIEWER', Role.VIEWER, false, Role.VIEWER, true],
      ['non-member needs VIEWER', null, false, Role.VIEWER, false],
      ['admin needs OWNER', null, true, Role.OWNER, true],
    ];

    it.each(cases)('%s', async (_label, membership, admin, min, allowed) => {
      arrangeUser(admin);
      m(prisma.spaceMember.findUnique).mockResolvedValue(
        membership ? { role: membership } : null,
      );
      const call = service.assertSpaceRole(USER, SPACE, min, 'custom message');
      if (allowed) {
        await expect(call).resolves.toBeUndefined();
      } else {
        await expect(call).rejects.toThrow(
          new ForbiddenException('custom message'),
        );
      }
    });
  });

  describe('resolveDocumentRole', () => {
    interface Case {
      label: string;
      spaceRole?: Role;
      docRole?: Role;
      admin?: boolean;
      expected: Role | null;
    }
    const cases: Case[] = [
      { label: 'space OWNER', spaceRole: Role.OWNER, expected: Role.OWNER },
      { label: 'space EDITOR', spaceRole: Role.EDITOR, expected: Role.EDITOR },
      { label: 'space VIEWER', spaceRole: Role.VIEWER, expected: Role.VIEWER },
      { label: 'non-member', expected: null },
      { label: 'system admin', admin: true, expected: Role.OWNER },
      {
        label: 'space VIEWER + document EDITOR (raised)',
        spaceRole: Role.VIEWER,
        docRole: Role.EDITOR,
        expected: Role.EDITOR,
      },
      {
        label: 'space EDITOR + document VIEWER (lowered)',
        spaceRole: Role.EDITOR,
        docRole: Role.VIEWER,
        expected: Role.VIEWER,
      },
      {
        label: 'space OWNER + document VIEWER (OWNER wins)',
        spaceRole: Role.OWNER,
        docRole: Role.VIEWER,
        expected: Role.OWNER,
      },
      {
        label: 'non-member + document EDITOR',
        docRole: Role.EDITOR,
        expected: Role.EDITOR,
      },
      {
        label: 'system admin + document VIEWER (admin wins)',
        admin: true,
        docRole: Role.VIEWER,
        expected: Role.OWNER,
      },
    ];

    it.each(cases)('$label -> $expected', async (c) => {
      arrangeUser(c.admin ?? false);
      arrangeDocument(c);
      await expect(service.resolveDocumentRole(USER, DOC)).resolves.toBe(
        c.expected,
      );
    });

    it('throws 404 for a missing document', async () => {
      arrangeUser(false);
      arrangeDocument({ missing: true });
      await expect(service.resolveDocumentRole(USER, DOC)).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each([
      ['member', { spaceRole: Role.OWNER }, false],
      ['system admin', {}, true],
    ])('throws 404 for an archived document (%s)', async (_l, doc, admin) => {
      arrangeUser(admin);
      arrangeDocument({ ...doc, archived: true });
      await expect(service.resolveDocumentRole(USER, DOC)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('resolves archived documents only with includeArchived', async () => {
      arrangeUser(false);
      arrangeDocument({ spaceRole: Role.OWNER, archived: true });
      await expect(
        service.resolveDocumentRole(USER, DOC, { includeArchived: true }),
      ).resolves.toBe(Role.OWNER);
    });
  });

  describe('assertDocumentRole', () => {
    it('returns the loaded document when allowed', async () => {
      arrangeUser(false);
      arrangeDocument({ spaceRole: Role.EDITOR });
      const doc = await service.assertDocumentRole(USER, DOC, Role.EDITOR);
      expect(doc.id).toBe(DOC);
    });

    it('403 mentions the document when a document override decided', async () => {
      arrangeUser(false);
      arrangeDocument({ spaceRole: Role.EDITOR, docRole: Role.VIEWER });
      await expect(
        service.assertDocumentRole(USER, DOC, Role.EDITOR),
      ).rejects.toThrow(
        new ForbiddenException(
          'Insufficient permissions for this document. Required: OWNER,EDITOR',
        ),
      );
    });

    it('403 mentions the space when the space role decided', async () => {
      arrangeUser(false);
      arrangeDocument({});
      await expect(
        service.assertDocumentRole(USER, DOC, Role.VIEWER),
      ).rejects.toThrow(
        new ForbiddenException(
          'Insufficient permissions in this space. Required: OWNER,EDITOR,VIEWER',
        ),
      );
    });

    it('404 (not 403) for an archived document, even for a space OWNER', async () => {
      arrangeUser(false);
      arrangeDocument({ spaceRole: Role.OWNER, archived: true });
      await expect(
        service.assertDocumentRole(USER, DOC, Role.VIEWER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertDocumentOwner', () => {
    const MESSAGE = 'Only OWNERs can do this';

    it('allows a space OWNER on an archived document', async () => {
      arrangeUser(false);
      arrangeDocument({ spaceRole: Role.OWNER, archived: true });
      await expect(
        service.assertDocumentOwner(USER, DOC, MESSAGE),
      ).resolves.toMatchObject({ id: DOC });
    });

    it('allows a document-level OWNER and a system admin', async () => {
      arrangeUser(false);
      arrangeDocument({ docRole: Role.OWNER });
      await expect(
        service.assertDocumentOwner(USER, DOC, MESSAGE),
      ).resolves.toBeDefined();

      arrangeUser(true);
      arrangeDocument({ archived: true });
      await expect(
        service.assertDocumentOwner(USER, DOC, MESSAGE),
      ).resolves.toBeDefined();
    });

    it('rejects an EDITOR with 403 and a missing document with 404', async () => {
      arrangeUser(false);
      arrangeDocument({ spaceRole: Role.EDITOR });
      await expect(
        service.assertDocumentOwner(USER, DOC, MESSAGE),
      ).rejects.toThrow(new ForbiddenException(MESSAGE));

      arrangeDocument({ missing: true });
      await expect(
        service.assertDocumentOwner(USER, DOC, MESSAGE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('accessibleDocumentsWhere', () => {
    it('lets admins see every non-archived document', async () => {
      arrangeUser(true);
      await expect(service.accessibleDocumentsWhere(USER)).resolves.toEqual({
        isArchived: false,
      });
    });

    it('limits other users to their spaces and shared documents', async () => {
      arrangeUser(false);
      await expect(service.accessibleDocumentsWhere(USER)).resolves.toEqual({
        isArchived: false,
        OR: [
          { space: { members: { some: { userId: USER } } } },
          { members: { some: { userId: USER } } },
        ],
      });
    });
  });
});
