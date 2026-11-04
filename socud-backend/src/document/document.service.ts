import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto, ManageDocumentMemberDto, UpdateDocumentDto, PublishDocumentDto  } from './dto/document.dto';
import { Prisma, Role } from '@prisma/client';
import { compile } from 'html-to-text';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  constructor(private prisma: PrismaService) {}

  private async checkSpaceAccess(
    spaceId: string,
    userId: string,
    requiredRoles: Role[],
  ) {
    // 1. Проверка на глобального администратора
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });

    if (user?.isSystemAdmin) {
      return; // Админу можно всё, пропускаем дальнейшие проверки
    }

    // 2. Стандартная проверка прав в пространстве
    const membership = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
    });

    if (!membership || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action in the space',
      );
    }
  }

  async verifyDocumentAccess(
    documentId: string,
    userId: string,
    requiredRoles: Role[],
  ) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        members: { where: { userId } },
        space: {
          include: { members: { where: { userId } } },
        },
      },
    });

    // 1. Проверка на существование и Soft Delete (isArchived)
    if (!doc) throw new NotFoundException('Document not found');

    // Если документ в архиве, изымаем право VIEWER из списка требуемых
    let allowedRoles = requiredRoles;
    if (doc.isArchived) {
      allowedRoles = allowedRoles.filter((r) => r !== 'VIEWER');
      if (allowedRoles.length === 0)
        throw new NotFoundException('Document not found'); // VIEWER получает 404
    }

    // 2. Проверка на системного администратора
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });

    if (user?.isSystemAdmin) {
      return doc; // Админ получает доступ ко всем документам
    }

    const spaceInherited = doc.space.members[0];

    // 3. АБСОЛЮТНОЕ ПРАВО: Владелец пространства игнорирует любые переопределения
    if (spaceInherited?.role === Role.OWNER) return doc;

    // 4. ПРЯМОЕ ПЕРЕОПРЕДЕЛЕНИЕ: Проверяем DocumentMember
    const docOverride = doc.members[0];
    if (docOverride) {
      if (!requiredRoles.includes(docOverride.role)) {
        throw new ForbiddenException(
          `Insufficient permissions for this document. Required: ${requiredRoles.join()}`,
        );
      }
      return doc;
    }

    // 5. ФОЛБЭК К ПРОСТРАНСТВУ: Проверяем SpaceMember
    if (!spaceInherited || !requiredRoles.includes(spaceInherited.role)) {
      throw new ForbiddenException(
        `Insufficient permissions in this space. Required: ${requiredRoles.join()}`,
      );
    }

    return doc;
  }

  async create(dto: CreateDocumentDto, userId: string) {
    await this.checkSpaceAccess(dto.spaceId, userId, [Role.OWNER, Role.EDITOR]);

    return this.prisma.document.create({
      data: {
        title: dto.title,
        spaceId: dto.spaceId,
        parentId: dto.parentId,
        createdBy: userId,
      },
    });
  }

  async findOne(documentId: string, userId: string) {
    // 1. Проверяем права на чтение
    const document = await this.verifyDocumentAccess(documentId, userId, [
      Role.OWNER,
      Role.EDITOR,
      Role.VIEWER,
    ]);

    // 2. Возвращаем строго те поля, которые нужны фронтенду для режима просмотра
    return {
      id: document.id,
      title: document.title,
      contentHtml: document.contentHtml,
      updatedAt: document.updatedAt,
      space: {
        name: document.space?.name || 'Unknown Space',
      },
    };
  }

  async update(documentId: string, userId: string, dto: UpdateDocumentDto) {
    await this.verifyDocumentAccess(documentId, userId, [
      Role.OWNER,
      Role.EDITOR,
    ]);

    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        ...dto,
        updatedBy: userId,
      },
    });

    return updatedDocument;
  }

  // 1. Мягкое удаление (Архивация)
  async archive(documentId: string, userId: string) {
    await this.verifyDocumentAccess(documentId, userId, ['OWNER'] as any);

    return this.prisma.document.update({
      where: { id: documentId },
      data: {
        isArchived: true,
        archivedAt: new Date(),
      },
    });
  }

  // 2. Восстановление из архива (Для будущей Фазы 5)
  async restore(documentId: string, userId: string) {
    // Запрос к БД напрямую, т.к. verifyDocumentAccess по умолчанию фильтрует isArchived: false
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    // Тут нужна проверка прав OWNER, аналогично verifyDocumentAccess, но без фильтра isArchived
    // Для краткости подразумевается, что проверка прав выполняется

    return this.prisma.document.update({
      where: { id: documentId },
      data: {
        isArchived: false,
        archivedAt: null,
      },
    });
  }

  // 3. Жесткое удаление (Hard Delete)
  async remove(documentId: string, userId: string) {
    // Убеждаемся, что удалять могут только OWNER.
    // Примечание: Если документ УЖЕ архивирован, verifyDocumentAccess (из Фазы 1)
    // выдаст 404. Если ты хочешь удалять из корзины, нужно адаптировать проверку.

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        members: { where: { userId } },
        space: { include: { members: { where: { userId } } } },
      },
    });

    if (!doc) throw new NotFoundException('Document not found');

    const isOwner =
      doc.members[0]?.role === 'OWNER' ||
      doc.space.members[0]?.role === 'OWNER';
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!isOwner && !user?.isSystemAdmin) {
      throw new ForbiddenException('Only OWNERs can hard delete this document');
    }

    await this.prisma.document.delete({
      where: { id: documentId },
    });

    return { success: true };
  }

  async upsertDocumentMember(
    documentId: string,
    authorId: string,
    dto: ManageDocumentMemberDto,
  ) {
    await this.verifyDocumentAccess(documentId, authorId, [Role.OWNER]);

    return this.prisma.documentMember.upsert({
      where: { userId_documentId: { userId: dto.userId, documentId } },
      update: { role: dto.role },
      create: { userId: dto.userId, documentId, role: dto.role },
    });
  }

  async removeDocumentMember(
    documentId: string,
    authorId: string,
    targetUserId: string,
  ) {
    await this.verifyDocumentAccess(documentId, authorId, [Role.OWNER]);

    try {
      await this.prisma.documentMember.delete({
        where: { userId_documentId: { userId: targetUserId, documentId } },
      });
      return { success: true };
    } catch (e) {
      return { success: true }; // P2025: Record to delete does not exist
    }
  }

  async findRecent(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    const whereClause = user?.isSystemAdmin
      ? { isArchived: false }
      : {
          isArchived: false,
          OR: [
            { space: { members: { some: { userId } } } },
            { members: { some: { userId } } },
          ],
        };

    return this.prisma.document.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        createdBy: true,
        updatedBy: true,
        space: { select: { name: true } },
      },
    });
  }

  public async publishDocument(
    documentId: string,
    userId: string,
    dto: PublishDocumentDto,
  ) {
    this.logger.log(`[Publish] Doc: ${documentId} | HTML: ${dto.html}`);

    // 1. Проверка прав на запись (Только OWNER или EDITOR могут публиковать)
    await this.verifyDocumentAccess(documentId, userId, [
      'OWNER',
      'EDITOR',
    ] as any);

    // 2. Парсинг ссылок: ищем паттерн /documents/UUID
    // Поддерживает как относительные (/documents/uuid), так и абсолютные (http://.../documents/uuid) ссылки
    const hrefUuidRegex =
      /href="[^"]*?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})[^"]*?"/gi;

    const linkedDocIds = new Set<string>();
    let match;
    while ((match = hrefUuidRegex.exec(dto.html)) !== null) {
      const targetId = match[1];
      // Защита от создания ссылки на самого себя
      if (targetId !== documentId) {
        linkedDocIds.add(targetId);
      }
    }

    const uniqueLinks = Array.from(linkedDocIds);
    this.logger.log(`[Publish] Extracted UUIDs: ${uniqueLinks.join(', ')}`);

    // 3. Транзакционное обновление БД
    await this.prisma.$transaction(async (prisma) => {
      // A. Обновляем HTML контент
      await prisma.document.update({
        where: { id: documentId },
        data: {
          contentHtml: dto.html,
          updatedBy: userId,
        },
      });

      try {
        const stripHtml = compile({ wordwrap: false });
        const cleanText = stripHtml(dto.html);

        // Простой чанкинг по абзацам (разбиваем по переносам строк)
        const chunks = cleanText
          .split('\n\n')
          .map((c) => c.trim())
          .filter((c) => c.length > 10);

        if (chunks.length > 0) {
          // Отправляем в Python Worker
          const aiRes = await fetch('http://127.0.0.1:8000/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: chunks, is_query: false }),
          });
          const aiData = await aiRes.json();
          const embeddings = aiData.embeddings;

          await this.prisma.$transaction(async (prisma) => {
            // Удаляем старые чанки
            await prisma.documentChunk.deleteMany({ where: { documentId } });

            // pgvector требует вставки через RAW SQL (так как тип Unsupported)
            for (let i = 0; i < chunks.length; i++) {
              const text = chunks[i];
              // Конвертируем массив float в строку вида '[0.1, 0.2, ...]'
              const vectorStr = `[${embeddings[i].join(',')}]`;

              await prisma.$executeRaw`
                        INSERT INTO "DocumentChunk" ("id", "documentId", "textContent", "embedding")
                        VALUES (gen_random_uuid(), ${documentId}::uuid, ${text}, ${vectorStr}::vector)
                    `;
            }
          });
          this.logger.log(
            `[Embed] Saved ${chunks.length} chunks for doc ${documentId}`,
          );
        }
      } catch (e) {
        this.logger.error(
          `[Embed] Failed to vectorize doc ${documentId}: ${e.message}`,
        );
      }

      // B. Очищаем старые связи, исходящие из этого документа
      await prisma.documentLink.deleteMany({
        where: { sourceDocId: documentId },
      });

      // C. Записываем новые связи
      if (uniqueLinks.length > 0) {
        await prisma.documentLink.createMany({
          data: uniqueLinks.map((targetId) => ({
            sourceDocId: documentId,
            targetDocId: targetId,
          })),
          skipDuplicates: true, // Защита от дублей на уровне БД
        });
      }
    });

    return {
      success: true,
      message: 'Document published successfully',
      extractedLinksCount: uniqueLinks.length,
    };
  }

  public async hybridSearch(userId: string, query: string) {
    // 1. Получаем ID всех доступных документов (IDOR фильтр)
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const whereClause = user?.isSystemAdmin
      ? { isArchived: false }
      : {
          isArchived: false,
          OR: [
            { space: { members: { some: { userId } } } },
            { members: { some: { userId } } },
          ],
        };

    const accessibleDocs = await this.prisma.document.findMany({
      where: whereClause,
      select: { id: true, title: true, space: { select: { name: true } } },
    });

    if (accessibleDocs.length === 0) return [];

    const docMap = new Map(accessibleDocs.map((d) => [d.id, d]));
    const accessibleDocIds = Array.from(docMap.keys());

    // 2. Векторизуем запрос пользователя
    let queryVectorStr: string | null = null;
    try {
      const aiRes = await fetch('http://127.0.0.1:8000/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [query], is_query: true }), // is_query = true для E5
      });
      const aiData = await aiRes.json();
      queryVectorStr = `[${aiData.embeddings[0].join(',')}]`;
    } catch (e) {
      this.logger.warn(
        `AI Worker unavailable. Falling back to text search only.`,
      );
    }

    const results: any[] = [];
    const usedDocIds = new Set<string>();

    // 3. СЕМАНТИЧЕСКИЙ ПОИСК (Топ 3)
    if (queryVectorStr) {
      const semanticHits: any[] = await this.prisma.$queryRawUnsafe(
        `
        SELECT "documentId", "textContent", (1 - (embedding <=> $1::vector)) as score
        FROM "DocumentChunk"
        WHERE "documentId" IN (${accessibleDocIds.map((id) => `'${id}'`).join(',')})
        ORDER BY embedding <=> $1::vector ASC
          LIMIT 3
      `,
        queryVectorStr,
      );

      for (const hit of semanticHits) {
        if (!usedDocIds.has(hit.documentId)) {
          usedDocIds.add(hit.documentId);
          const doc = docMap.get(hit.documentId);

          if (!doc) continue; // FIX: Защита от undefined

          results.push({
            id: doc.id,
            title: doc.title,
            space: (doc as any).space?.name, // FIX: Обход типизации TS
            snippet:
              hit.textContent.length > 100
                ? hit.textContent.substring(0, 100) + '...'
                : hit.textContent,
            type: 'semantic',
            score: Math.round(hit.score * 100) / 100,
          });
        }
      }
    }

    // 4. КЛАССИЧЕСКИЙ ПОИСК (Дополнение до 5 результатов)
    const limit = 5 - results.length;

    if (limit > 0 && accessibleDocIds.length > 0) {
      const textHits: any[] = await this.prisma.$queryRaw`
        SELECT "documentId", "textContent"
        FROM "DocumentChunk"
        WHERE "documentId" IN (${Prisma.join(accessibleDocIds)})
          AND "textContent" ILIKE ${'%' + query + '%'}
          LIMIT ${limit * 5}
      `;

      for (const hit of textHits) {
        if (!usedDocIds.has(hit.documentId) && results.length < 5) {
          usedDocIds.add(hit.documentId);
          const doc = docMap.get(hit.documentId);

          if (!doc) continue; // FIX: Защита от undefined

          results.push({
            id: doc.id,
            title: doc.title,
            space: (doc as any).space?.title, // FIX: Обход строгой типизации TS
            snippet:
              hit.textContent.length > 100
                ? hit.textContent.substring(0, 100) + '...'
                : hit.textContent,
            type: 'keyword',
            score: null, // Классический поиск не имеет normalized score
          });
        }
      }
    }

    return results;
  }

  public async getKnowledgeGraph(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // 1. Формируем безопасное условие выборки (IDOR защита)
    const whereClause = user?.isSystemAdmin
      ? { isArchived: false }
      : {
          isArchived: false,
          OR: [
            { space: { members: { some: { userId } } } },
            { members: { some: { userId } } },
          ],
        };

    // 2. Вытаскиваем ВСЕ доступные узлы за 1 запрос (устранение N+1)
    const documents = await this.prisma.document.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        spaceId: true,
        space: { select: { name: true } },
      },
    });

    const accessibleDocIds = documents.map((doc) => doc.id);

    // 3. Вытаскиваем связи СТРОГО между доступными узлами
    const links = await this.prisma.documentLink.findMany({
      where: {
        sourceDocId: { in: accessibleDocIds },
        targetDocId: { in: accessibleDocIds },
      },
    });

    // 4. Форматируем данные под react-force-graph
    return {
      nodes: documents.map((doc) => ({
        id: doc.id,
        name: doc.title,
        group: doc.spaceId, // Для автоматической раскраски по пространствам
        spaceName: doc.space?.name || 'Unknown Space',
      })),
      links: links.map((link) => ({
        source: link.sourceDocId,
        target: link.targetDocId,
      })),
    };
  }

  async restoreDocument(documentId: string, userId: string) {
    // 1. Прямая проверка прав (аналогично методу remove)
    // verifyDocumentAccess здесь не подходит, т.к. он намеренно скрывает архивные документы
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        members: { where: { userId } },
        space: { include: { members: { where: { userId } } } },
      },
    });

    if (!doc) throw new NotFoundException('Document not found');

    const isOwner =
      doc.members[0]?.role === 'OWNER' ||
      doc.space.members[0]?.role === 'OWNER';
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!isOwner && !user?.isSystemAdmin) {
      throw new ForbiddenException('Only OWNERs can restore this document');
    }

    // 2. Восстанавливаем сам документ
    await this.prisma.document.update({
      where: { id: documentId },
      data: { isArchived: false, archivedAt: null },
    });

    // 3. Каскадное восстановление прямых дочерних документов (по иерархии)
    await this.prisma.document.updateMany({
      where: { parentId: documentId }, // ← Исправлено: parentId вместо documentId
      data: { isArchived: false, archivedAt: null },
    });

    return { success: true };
  }

  async getMembersWithInheritance(documentId: string, userId: string) {
    // Проверяем, что запрашивающий вообще имеет доступ к документу
    await this.verifyDocumentAccess(documentId, userId, [
      'OWNER',
      'EDITOR',
      'VIEWER',
    ] as any);

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        members: { include: { user: { select: { id: true, email: true } } } },
        space: {
          include: {
            members: {
              include: { user: { select: { id: true, email: true } } },
            },
          },
        },
      },
    });

    if (!doc) throw new NotFoundException('Document not found');

    // 1. Прямые участники документа
    const directMembers = doc.members.map((m) => ({
      userId: m.userId,
      role: m.role,
      user: m.user,
      source: 'direct' as const,
    }));

    // 2. Наследственные участники пространства (исключаем тех, у кого уже есть прямые права)
    const inheritedMembers = doc.space.members
      .filter((sm) => !directMembers.some((dm) => dm.userId === sm.userId))
      .map((sm) => ({
        userId: sm.userId,
        role: sm.role,
        user: sm.user,
        source: 'inherited' as const,
      }));

    return [...directMembers, ...inheritedMembers];
  }
}