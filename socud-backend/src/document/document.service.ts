import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDocumentDto,
  ManageDocumentMemberDto,
  UpdateDocumentDto,
  PublishDocumentDto,
} from './dto/document.dto';
import { Prisma, Role } from '@prisma/client';
import { compile } from 'html-to-text';
import { sanitizeDocumentHtml } from '../common/html-sanitizer';
import { PermissionService } from '../permission/permission.service';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private permissions: PermissionService,
  ) {}

  private get embedUrl(): string {
    const base = this.config.getOrThrow<string>('AI_WORKER_URL');
    return `${base.replace(/\/+$/, '')}/embed`;
  }

  /** Request timeout for the AI worker so a hung worker cannot block requests forever. */
  private static readonly EMBED_TIMEOUT_MS = 15000;

  private get embedHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.config.get<string>('AI_WORKER_TOKEN');
    if (token) headers['X-Worker-Token'] = token;
    return headers;
  }

  async create(dto: CreateDocumentDto, userId: string) {
    await this.permissions.assertSpaceRole(userId, dto.spaceId, Role.EDITOR);

    if (dto.parentId) {
      const parent = await this.prisma.document.findUnique({
        where: { id: dto.parentId },
        select: { spaceId: true, isArchived: true },
      });
      if (!parent || parent.spaceId !== dto.spaceId || parent.isArchived) {
        throw new BadRequestException(
          'Parent document must exist, belong to the same space and not be archived',
        );
      }
    }

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
    const document = await this.permissions.assertDocumentRole(
      userId,
      documentId,
      Role.VIEWER,
    );

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
    await this.permissions.assertDocumentRole(userId, documentId, Role.EDITOR);

    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        title: dto.title.trim(),
        updatedBy: userId,
      },
    });

    return updatedDocument;
  }

  // 1. Мягкое удаление (Архивация)
  async archive(documentId: string, userId: string) {
    await this.permissions.assertDocumentRole(userId, documentId, Role.OWNER);

    return this.prisma.document.update({
      where: { id: documentId },
      data: {
        isArchived: true,
        archivedAt: new Date(),
      },
    });
  }

  // 3. Жесткое удаление (Hard Delete)
  async remove(documentId: string, userId: string) {
    // Удалять могут только OWNER (и из корзины: assertDocumentOwner видит архивные документы).
    await this.permissions.assertDocumentOwner(
      userId,
      documentId,
      'Only OWNERs can hard delete this document',
    );

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
    await this.permissions.assertDocumentRole(authorId, documentId, Role.OWNER);

    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

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
    await this.permissions.assertDocumentRole(authorId, documentId, Role.OWNER);

    try {
      await this.prisma.documentMember.delete({
        where: { userId_documentId: { userId: targetUserId, documentId } },
      });
      return { success: true };
    } catch {
      return { success: true }; // P2025: Record to delete does not exist
    }
  }

  async findRecent(userId: string) {
    const whereClause = await this.permissions.accessibleDocumentsWhere(userId);

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
    // 1. Проверка прав на запись (Только OWNER или EDITOR могут публиковать)
    await this.permissions.assertDocumentRole(userId, documentId, Role.EDITOR);

    // 2. Санитизация: в БД попадает только HTML из белого списка (защита от stored XSS)
    const html = sanitizeDocumentHtml(dto.html);

    // 3. Парсинг ссылок: ищем паттерн /documents/UUID
    // Поддерживает как относительные (/documents/uuid), так и абсолютные (http://.../documents/uuid) ссылки
    const hrefUuidRegex =
      /href="[^"]*?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})[^"]*?"/gi;

    const linkedDocIds = new Set<string>();
    let match;
    while ((match = hrefUuidRegex.exec(html)) !== null) {
      const targetId = match[1];
      // Защита от создания ссылки на самого себя
      if (targetId !== documentId) {
        linkedDocIds.add(targetId);
      }
    }

    const uniqueLinks = Array.from(linkedDocIds);
    // Никогда не логируем содержимое документа
    this.logger.log(
      `[Publish] Doc: ${documentId} | HTML length: ${html.length} | Links: ${uniqueLinks.length}`,
    );

    // 4. Транзакционное обновление БД
    await this.prisma.$transaction(async (prisma) => {
      // A. Обновляем HTML контент
      await prisma.document.update({
        where: { id: documentId },
        data: {
          contentHtml: html,
          updatedBy: userId,
        },
      });

      try {
        const stripHtml = compile({ wordwrap: false });
        const cleanText = stripHtml(html);

        // Простой чанкинг по абзацам (разбиваем по переносам строк)
        const chunks = cleanText
          .split('\n\n')
          .map((c) => c.trim())
          .filter((c) => c.length > 10);

        if (chunks.length > 0) {
          // Отправляем в Python Worker
          const aiRes = await fetch(this.embedUrl, {
            method: 'POST',
            headers: this.embedHeaders,
            body: JSON.stringify({ texts: chunks, is_query: false }),
            signal: AbortSignal.timeout(DocumentService.EMBED_TIMEOUT_MS),
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
    const whereClause = await this.permissions.accessibleDocumentsWhere(userId);

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
      const aiRes = await fetch(this.embedUrl, {
        method: 'POST',
        headers: this.embedHeaders,
        body: JSON.stringify({ texts: [query], is_query: true }), // is_query = true для E5
        signal: AbortSignal.timeout(DocumentService.EMBED_TIMEOUT_MS),
      });
      const aiData = await aiRes.json();
      queryVectorStr = `[${aiData.embeddings[0].join(',')}]`;
    } catch {
      this.logger.warn(
        `AI Worker unavailable. Falling back to text search only.`,
      );
    }

    const results: any[] = [];
    const usedDocIds = new Set<string>();

    // 3. СЕМАНТИЧЕСКИЙ ПОИСК (Топ 3)
    if (queryVectorStr) {
      const semanticHits: any[] = await this.prisma.$queryRaw`
        SELECT "documentId", "textContent", (1 - (embedding <=> ${queryVectorStr}::vector)) as score
        FROM "DocumentChunk"
        WHERE "documentId" IN (${Prisma.join(accessibleDocIds)})
        ORDER BY embedding <=> ${queryVectorStr}::vector ASC
          LIMIT 3
      `;

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
    // 1. Формируем безопасное условие выборки (IDOR защита)
    const whereClause = await this.permissions.accessibleDocumentsWhere(userId);

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
    // 1. Прямая проверка прав: assertDocumentRole скрывает архивные документы,
    // поэтому используется assertDocumentOwner (аналогично методу remove)
    await this.permissions.assertDocumentOwner(
      userId,
      documentId,
      'Only OWNERs can restore this document',
    );

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
    await this.permissions.assertDocumentRole(userId, documentId, Role.VIEWER);

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
