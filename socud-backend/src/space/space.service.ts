import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSpaceDto,
  ManageSpaceMemberDto,
  UpdateSpaceDto,
} from './dto/space.dto';
import { Prisma, Role } from '@prisma/client';
import { PermissionService } from '../permission/permission.service';

@Injectable()
export class SpaceService {
  constructor(
    private prisma: PrismaService,
    private permissions: PermissionService,
  ) {}

  async create(dto: CreateSpaceDto, userId: string) {
    // The transaction guarantees the space is not created if creating the member fails (and vice versa)
    return this.prisma.$transaction(async (prisma) => {
      const space = await prisma.space.create({
        data: {
          name: dto.name,
          description: dto.description,
        },
      });

      // The creator must become the space OWNER
      await prisma.spaceMember.create({
        data: {
          spaceId: space.id,
          userId: userId,
          role: Role.OWNER,
        },
      });

      return space;
    });
  }

  async findAllForUser(userId: string) {
    // Return only spaces where the user is a member
    return this.prisma.space.findMany({
      where: {
        members: { some: { userId } },
      },
      include: {
        _count: { select: { documents: true, members: true } },
      },
    });
  }

  async findMySpaces(userId: string) {
    if (await this.permissions.isSystemAdmin(userId)) {
      return this.prisma.space.findMany({
        where: { isArchived: false },
        include: { _count: { select: { documents: true } } },
      });
    }

    return this.prisma.space.findMany({
      where: {
        isArchived: false,
        members: { some: { userId } },
      },
      include: { _count: { select: { documents: true } } },
    });
  }

  async findOne(spaceId: string, userId: string) {
    // 1. Access check (system admin or space member)
    await this.permissions.assertSpaceRole(
      userId,
      spaceId,
      Role.VIEWER,
      'You do not have access to this space',
    );

    // 2. Load the space together with its active documents
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId, isArchived: false },
      include: {
        documents: {
          where: { isArchived: false },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            title: true,
            updatedAt: true,
            updatedBy: true,
          },
        },
      },
    });

    if (!space) throw new NotFoundException('Space not found or archived');

    return space;
  }

  async archiveSpace(spaceId: string, userId: string) {
    // 1. Access check (OWNER or system admin only)
    await this.permissions.assertSpaceRole(
      userId,
      spaceId,
      Role.OWNER,
      'Only space OWNERs can delete or archive this space',
    );

    // 2. Cascade archive in a transaction

    const now = new Date(); // one timestamp for the whole transaction

    return this.prisma.$transaction(async (tx) => {
      // Archive the space itself
      const space = await tx.space.update({
        where: { id: spaceId },
        data: { isArchived: true, archivedAt: now },
      });

      // Archive ALL documents in this space
      await tx.document.updateMany({
        where: { spaceId: spaceId, isArchived: false },
        data: { isArchived: true, archivedAt: now },
      });

      return space;
    });
  }

  async removeSpace(spaceId: string, userId: string) {
    // 1. Access check (OWNER or system admin only)
    await this.permissions.assertSpaceRole(
      userId,
      spaceId,
      Role.OWNER,
      'Only space OWNERs can hard delete this space',
    );

    // Hard-delete the space. Documents are removed by the onDelete: Cascade
    // relation (Document -> Space) in the Prisma schema.
    await this.prisma.space.delete({
      where: { id: spaceId },
    });

    return { success: true };
  }

  async updateSpace(spaceId: string, userId: string, dto: UpdateSpaceDto) {
    // 1. Access check (OWNER, EDITOR or system admin only)
    await this.permissions.assertSpaceRole(
      userId,
      spaceId,
      Role.EDITOR,
      'Only OWNERs and EDITORs can update space details',
    );

    // 2. Build the update object.
    // The frontend's title maps to the name column (same as in create)
    const updateData: Prisma.SpaceUpdateInput = {};
    if (dto.title !== undefined) updateData.name = dto.title.trim();
    if (dto.description !== undefined) updateData.description = dto.description;

    return this.prisma.space.update({
      where: { id: spaceId },
      data: updateData,
    });
  }

  /**
   * Takes a space out of the trash (OWNERs and admins only). Only the documents archived together
   * with the space (identical `archivedAt`) come back; ones the user archived earlier stay in
   * the trash. Returns how many documents were restored. 409 if the space is not archived.
   */
  async restoreSpace(
    spaceId: string,
    userId: string,
  ): Promise<{ restored: number }> {
    // 1. Access check (OWNER or system admin only)
    await this.permissions.assertSpaceRole(
      userId,
      spaceId,
      Role.OWNER,
      'Only space OWNERs can restore this space',
    );

    return this.prisma.$transaction(async (tx) => {
      // The state BEFORE the restore gives the exact archive timestamp of the cascade.
      const before = await tx.space.findUnique({
        where: { id: spaceId },
        select: { isArchived: true, archivedAt: true },
      });
      if (!before) throw new NotFoundException('Space not found');
      if (!before.isArchived) {
        throw new ConflictException('Space is not archived');
      }

      await tx.space.update({
        where: { id: spaceId },
        data: { isArchived: false, archivedAt: null },
      });

      if (!before.archivedAt) return { restored: 0 };
      const { count } = await tx.document.updateMany({
        where: {
          spaceId,
          isArchived: true,
          archivedAt: before.archivedAt, // exact timestamp match
        },
        data: { isArchived: false, archivedAt: null },
      });
      return { restored: count };
    });
  }

  // ---------------------------------------------------------------------
  // Space membership management
  // ---------------------------------------------------------------------

  private async assertSpaceExists(spaceId: string): Promise<void> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true },
    });
    if (!space) throw new NotFoundException('Space not found');
  }

  private async assertUserExists(userId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');
  }

  /** Runs `fn` serializably so concurrent demotions cannot both pass the last-owner check. */
  private async inMembershipTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'The space membership was changed concurrently, please retry',
        );
      }
      throw error;
    }
  }

  private async assertNotLastOwner(
    tx: Prisma.TransactionClient,
    spaceId: string,
    action: 'remove' | 'demote',
  ): Promise<void> {
    const owners = await tx.spaceMember.count({
      where: { spaceId, role: Role.OWNER },
    });
    if (owners <= 1) {
      throw new ConflictException(
        `Cannot ${action} the last OWNER of a space. Assign another OWNER first.`,
      );
    }
  }

  async getMembers(spaceId: string, userId: string) {
    await this.permissions.assertSpaceRole(
      userId,
      spaceId,
      Role.VIEWER,
      'You do not have access to this space',
    );
    await this.assertSpaceExists(spaceId);

    return this.prisma.spaceMember.findMany({
      where: { spaceId },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  async upsertMember(
    spaceId: string,
    actorId: string,
    dto: ManageSpaceMemberDto,
  ) {
    await this.permissions.assertSpaceRole(
      actorId,
      spaceId,
      Role.OWNER,
      'Only space OWNERs can manage members',
    );
    await this.assertSpaceExists(spaceId);
    await this.assertUserExists(dto.userId);

    return this.inMembershipTransaction(async (tx) => {
      const existing = await tx.spaceMember.findUnique({
        where: { userId_spaceId: { userId: dto.userId, spaceId } },
      });

      if (existing?.role === Role.OWNER && dto.role !== Role.OWNER) {
        await this.assertNotLastOwner(tx, spaceId, 'demote');
      }

      return tx.spaceMember.upsert({
        where: { userId_spaceId: { userId: dto.userId, spaceId } },
        update: { role: dto.role },
        create: { userId: dto.userId, spaceId, role: dto.role },
      });
    });
  }

  async removeMember(spaceId: string, actorId: string, targetUserId: string) {
    await this.permissions.assertSpaceRole(
      actorId,
      spaceId,
      Role.OWNER,
      'Only space OWNERs can manage members',
    );
    await this.assertSpaceExists(spaceId);

    return this.inMembershipTransaction(async (tx) => {
      const existing = await tx.spaceMember.findUnique({
        where: { userId_spaceId: { userId: targetUserId, spaceId } },
      });
      if (!existing) {
        throw new NotFoundException('User is not a member of this space');
      }

      if (existing.role === Role.OWNER) {
        await this.assertNotLastOwner(tx, spaceId, 'remove');
      }

      await tx.spaceMember.delete({
        where: { userId_spaceId: { userId: targetUserId, spaceId } },
      });
      return { success: true };
    });
  }
}
