import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  recalledDocument,
  recalledSystemAdmin,
  rememberDocument,
  rememberSystemAdmin,
} from './request-memo';

/**
 * Role ordering: a higher rank includes every right of the lower ones.
 * Every access rule in the application is "at least role X", so a minimum role is enough.
 */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  [Role.VIEWER]: 1,
  [Role.EDITOR]: 2,
  [Role.OWNER]: 3,
};

/** True when `actual` is at least `min`. A missing role never satisfies anything. */
export function roleSatisfies(
  actual: Role | null | undefined,
  min: Role,
): boolean {
  return !!actual && ROLE_RANK[actual] >= ROLE_RANK[min];
}

/** All roles that satisfy `min`, strongest first (used for error messages). */
export function rolesAtLeast(min: Role): Role[] {
  return (Object.keys(ROLE_RANK) as Role[])
    .filter((role) => ROLE_RANK[role] >= ROLE_RANK[min])
    .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
}

/** A document together with the requesting user's document-level and space-level membership. */
export type DocumentWithAccess = Prisma.DocumentGetPayload<{
  include: {
    members: true;
    space: { include: { members: true } };
  };
}>;

/** Where the effective role of a document came from. */
type DocumentRoleSource = 'admin' | 'space-owner' | 'document' | 'space';

interface DocumentRoleResolution {
  role: Role | null;
  source: DocumentRoleSource;
}

/**
 * Single source of truth for "who may do what".
 *
 * Rules (unchanged from the previous per-service checks):
 * - A system admin has OWNER rights everywhere.
 * - Space role: the user's `SpaceMember` role, none for non-members.
 * - Document role: space OWNER always wins; otherwise a `DocumentMember` entry REPLACES the
 *   space role (it can both raise and lower it); without an entry the space role is inherited.
 * - Archived documents (the trash) do not exist for anyone, admins and OWNERs included; only the
 *   explicit `includeArchived` / `assertDocumentOwner` paths (restore, hard delete) see them.
 *
 * Failure modes: 404 (`NotFoundException`) when the document is missing or archived,
 * 403 (`ForbiddenException`) when the user lacks the role.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Always backed by the `User` row. During an HTTP request the flag `JwtStrategy` already read
   * for that request is reused (see `request-memo.ts`), so there is no second read and no
   * staleness; Hocuspocus, the queue and scripts have no request and read the row.
   */
  async isSystemAdmin(userId: string): Promise<boolean> {
    const known = recalledSystemAdmin(userId);
    if (known !== undefined) return known;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });
    const isAdmin = user?.isSystemAdmin === true;
    rememberSystemAdmin(userId, isAdmin);
    return isAdmin;
  }

  // ---------------------------------------------------------------------
  // Spaces
  // ---------------------------------------------------------------------

  /** Effective role in the space: OWNER for system admins, `null` for non-members. */
  async resolveSpaceRole(
    userId: string,
    spaceId: string,
  ): Promise<Role | null> {
    if (await this.isSystemAdmin(userId)) return Role.OWNER;

    const membership = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
    });
    return membership?.role ?? null;
  }

  /** Throws 403 (with `message`) unless the user has at least `min` in the space. */
  async assertSpaceRole(
    userId: string,
    spaceId: string,
    min: Role,
    message = 'You do not have permission to perform this action in the space',
  ): Promise<void> {
    const role = await this.resolveSpaceRole(userId, spaceId);
    if (!roleSatisfies(role, min)) throw new ForbiddenException(message);
  }

  // ---------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------

  /**
   * Effective role in the document. Throws 404 if the document does not exist or is archived
   * (unless `includeArchived`). `null` when the user has no access.
   */
  async resolveDocumentRole(
    userId: string,
    documentId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<Role | null> {
    const doc = await this.loadDocument(userId, documentId, options);
    return (await this.resolveFor(userId, doc)).role;
  }

  /**
   * Throws 404 for a missing/archived document and 403 unless the user has at least `min`;
   * otherwise returns the loaded document (with the user's memberships).
   */
  async assertDocumentRole(
    userId: string,
    documentId: string,
    min: Role,
  ): Promise<DocumentWithAccess> {
    const doc = await this.loadDocument(userId, documentId);
    const { role, source } = await this.resolveFor(userId, doc);

    if (!roleSatisfies(role, min)) {
      const required = rolesAtLeast(min).join();
      throw new ForbiddenException(
        source === 'document'
          ? `Insufficient permissions for this document. Required: ${required}`
          : `Insufficient permissions in this space. Required: ${required}`,
      );
    }
    return doc;
  }

  /**
   * OWNER-only check that, unlike `assertDocumentRole`, also works for archived documents
   * (restore from trash, hard delete). 404 only if the document does not exist at all.
   */
  async assertDocumentOwner(
    userId: string,
    documentId: string,
    message: string,
  ): Promise<DocumentWithAccess> {
    const doc = await this.loadDocument(userId, documentId, {
      includeArchived: true,
    });
    const { role } = await this.resolveFor(userId, doc);
    if (!roleSatisfies(role, Role.OWNER)) throw new ForbiddenException(message);
    return doc;
  }

  /**
   * Prisma filter for "documents the user may see" (listing, graph, search): not archived and
   * the user is a member of the space or of the document itself; system admins see everything.
   */
  async accessibleDocumentsWhere(
    userId: string,
  ): Promise<Prisma.DocumentWhereInput> {
    if (await this.isSystemAdmin(userId)) return { isArchived: false };
    return {
      isArchived: false,
      OR: [
        { space: { members: { some: { userId } } } },
        { members: { some: { userId } } },
      ],
    };
  }

  /**
   * SQL twin of `accessibleDocumentsWhere` for raw queries (search), so the filter runs inside the
   * database instead of shipping every accessible id to the app. `alias` is the alias of the
   * "Document" table in the caller's query. Keep the two in sync: the rule is "not archived and
   * (system admin or member of the space or member of the document)".
   */
  accessibleDocumentsSql(userId: string, alias = 'd'): Prisma.Sql {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
      throw new Error(`Invalid SQL alias: ${alias}`);
    }
    const doc = Prisma.raw(alias);
    return Prisma.sql`(${doc}."isArchived" = false AND (
      EXISTS (SELECT 1 FROM "User" u WHERE u."id" = ${userId} AND u."isSystemAdmin")
      OR EXISTS (SELECT 1 FROM "SpaceMember" sm WHERE sm."spaceId" = ${doc}."spaceId" AND sm."userId" = ${userId})
      OR EXISTS (SELECT 1 FROM "DocumentMember" dm WHERE dm."documentId" = ${doc}."id" AND dm."userId" = ${userId})
    ))`;
  }

  private async loadDocument(
    userId: string,
    documentId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<DocumentWithAccess> {
    // The RoleGuard and the service's own check load the same row within one request.
    const doc =
      recalledDocument(userId, documentId) ??
      (await this.prisma.document.findUnique({
        where: { id: documentId },
        include: {
          members: { where: { userId } },
          space: { include: { members: { where: { userId } } } },
        },
      }));
    if (doc) rememberDocument(userId, documentId, doc);

    // The trash is invisible to everybody (see class comment).
    if (!doc || (doc.isArchived && !options.includeArchived)) {
      throw new NotFoundException('Document not found');
    }
    return doc;
  }

  private async resolveFor(
    userId: string,
    doc: DocumentWithAccess,
  ): Promise<DocumentRoleResolution> {
    if (await this.isSystemAdmin(userId)) {
      return { role: Role.OWNER, source: 'admin' };
    }

    const spaceRole = doc.space.members[0]?.role ?? null;
    // A space OWNER ignores any document-level override.
    if (spaceRole === Role.OWNER) {
      return { role: Role.OWNER, source: 'space-owner' };
    }

    const override = doc.members[0];
    if (override) return { role: override.role, source: 'document' };

    return { role: spaceRole, source: 'space' };
  }
}
