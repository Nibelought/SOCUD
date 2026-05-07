import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSpaceDto } from './dto/space.dto';
import { Role } from '@prisma/client';

@Injectable()
export class SpaceService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSpaceDto, userId: string) {
    // Транзакция гарантирует: если упадет создание члена, пространство не создастся (и наоборот)
    return this.prisma.$transaction(async (prisma) => {
      const space = await prisma.space.create({
        data: {
          name: dto.name,
          description: dto.description,
        },
      });

      // КРИТИЧЕСКИ ВАЖНО: Делаем создателя ВЛАДЕЛЬЦЕМ пространства
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
    // Возвращаем только те пространства, где пользователь числится участником
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (user?.isSystemAdmin) {
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
    // 1. Проверка прав (глобальный админ или участник пространства)
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.isSystemAdmin) {
      const membership = await this.prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId, spaceId } },
      });
      if (!membership) {
        throw new ForbiddenException('You do not have access to this space');
      }
    }

    // 2. Извлечение пространства вместе с его активными документами
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
    // 1. Проверяем права (Только OWNER или SystemAdmin)
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.isSystemAdmin) {
      const membership = await this.prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId, spaceId } },
      });
      if (!membership || membership.role !== Role.OWNER) {
        throw new ForbiddenException(
          'Only space OWNERs can delete or archive this space',
        );
      }
    }

    // 2. Транзакционное каскадное архивирование

    const now = new Date(); // Фиксируем единое время для всей транзакции

    return this.prisma.$transaction(async (tx) => {
      // Архивируем само пространство
      const space = await tx.space.update({
        where: { id: spaceId },
        data: { isArchived: true, archivedAt: now },
      });

      // Архивируем ВСЕ документы внутри этого пространства
      await tx.document.updateMany({
        where: { spaceId: spaceId, isArchived: false },
        data: { isArchived: true, archivedAt: now },
      });

      return space;
    });
  }

  async removeSpace(spaceId: string, userId: string) {
    // 1. Проверяем права (Только OWNER или SystemAdmin)
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.isSystemAdmin) {
      const membership = await this.prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId, spaceId } },
      });
      if (!membership || membership.role !== Role.OWNER) {
        throw new ForbiddenException(
          'Only space OWNERs can hard delete this space',
        );
      }
    }

    // Физическое удаление пространства.
    // Если в Prisma Schema у тебя настроено onDelete: Cascade для Document -> Space,
    // то документы удалятся сами. Если нет — нужно удалять сначала документы.
    await this.prisma.space.delete({
      where: { id: spaceId },
    });

    return { success: true };
  }

  async updateSpace(
    spaceId: string,
    userId: string,
    dto: { title?: string; description?: string },
  ) {
    // 1. Проверяем права (Только OWNER, EDITOR или SystemAdmin)
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.isSystemAdmin) {
      const membership = await this.prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId, spaceId } },
      });

      if (
        !membership ||
        (membership.role !== Role.OWNER && membership.role !== Role.EDITOR)
      ) {
        throw new ForbiddenException(
          'Only OWNERs and EDITORs can update space details',
        );
      }
    }

    // 2. Формируем объект обновления.
    // Маппим title с фронтенда на поле name в базе данных (согласно твоему методу create)
    const updateData: any = {};
    if (dto.title !== undefined) updateData.name = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;

    return this.prisma.space.update({
      where: { id: spaceId },
      data: updateData,
    });
  }

  async restoreSpace(spaceId: string, userId: string) {
    // 1. Проверяем права (Только OWNER или SystemAdmin)
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.isSystemAdmin) {
      const membership = await this.prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId, spaceId } },
      });
      if (!membership || membership.role !== Role.OWNER) {
        throw new ForbiddenException(
          'Only space OWNERs can restore this space',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Получаем состояние ДО восстановления, чтобы узнать точное время архивации
      const spaceBeforeRestore = await tx.space.findUnique({
        where: { id: spaceId },
        select: { archivedAt: true },
      });

      if (!spaceBeforeRestore) {
        throw new NotFoundException('Space not found');
      }

      // 2. Восстанавливаем само пространство
      const restoredSpace = await tx.space.update({
        where: { id: spaceId },
        data: { isArchived: false, archivedAt: null },
      });

      // 3. Каскадное восстановление документов
      // Восстанавливаем ТОЛЬКО те, что были заархивированы ОДНОВРЕМЕННО с пространством.
      // Это защищает от случайного восстановления документов, скрытых пользователем вручную ранее.
      if (spaceBeforeRestore.archivedAt) {
        await tx.document.updateMany({
          where: {
            spaceId: spaceId,
            isArchived: true,
            archivedAt: spaceBeforeRestore.archivedAt, // Точное совпадение timestamp
          },
          data: { isArchived: false, archivedAt: null },
        });
      }

      return restoredSpace;
    });
  }
}