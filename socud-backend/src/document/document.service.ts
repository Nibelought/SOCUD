import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ConflictException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDocumentDto,
  ManageDocumentMemberDto,
  UpdateDocumentDto,
  PublishDocumentDto,
} from './dto/document.dto';
import { Role } from '@prisma/client';
import { sanitizeDocumentHtml } from '../common/html-sanitizer';
import { chunkHtml } from '../pipeline/chunker';
import { htmlToPlainText } from '../pipeline/html-text';
import { extractLinkedDocumentIds } from '../pipeline/links';
import { renderYjsState } from '../pipeline/yjs-render';
import { LiveDocumentRegistry } from '../pipeline/live-document.registry';
import { PermissionService } from '../permission/permission.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private static readonly VERSION_LIST_LIMIT = 100;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private permissions: PermissionService,
    // Optional so the service (and its unit tests) work without Redis wiring; publish then just
    // does not enqueue and the reconcile job picks the document up.
    @Optional() private queue?: QueueService,
    // Source of the live Yjs state, filled by Hocuspocus (see LiveDocumentRegistry).
    @Optional() private liveDocuments?: LiveDocumentRegistry,
  ) {}

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
      isArchived: document.isArchived,
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

    // 2. Источник контента — состояние Yjs на сервере (живое или последнее сохранённое);
    // HTML от клиента используется только если у документа ещё нет Yjs-состояния.
    let yjsState = this.liveDocuments?.getState(documentId) ?? null;
    if (!yjsState) {
      const stored = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { yjsState: true },
      });
      yjsState = stored?.yjsState ?? null;
    }
    const { html, text } = this.resolvePublishedContent(
      documentId,
      yjsState,
      dto.html,
    );

    // 3. Ссылки на другие документы (паттерн /documents/UUID) и чанки для эмбеддингов
    const candidateLinks = extractLinkedDocumentIds(html, documentId);
    const chunks = chunkHtml(html);
    // Никогда не логируем содержимое документа
    this.logger.log(
      `[Publish] Doc: ${documentId} | HTML length: ${html.length} | Links: ${candidateLinks.length}`,
    );

    // 4. Транзакция — только работа с БД (никаких сетевых вызовов): документ, версия, чанки, связи
    const { version, links } = await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.document.update({
          where: { id: documentId },
          data: {
            contentHtml: html,
            draftHtml: html,
            draftText: text,
            updatedBy: userId,
            publishedVersion: { increment: 1 },
          },
          select: { publishedVersion: true, title: true },
        });
        const version = updated.publishedVersion;

        await tx.documentVersion.create({
          data: {
            documentId,
            version,
            title: updated.title,
            contentHtml: html,
            yjsState: yjsState ? Buffer.from(yjsState) : undefined,
            createdBy: userId,
          },
        });

        // Новые чанки без эмбеддинга; вектора запишет задача embed-document
        await tx.documentChunk.deleteMany({ where: { documentId } });
        if (chunks.length > 0) {
          await tx.documentChunk.createMany({
            data: chunks.map((textContent, chunkIndex) => ({
              documentId,
              chunkIndex,
              textContent,
            })),
          });
        }

        // Ссылка на несуществующий/удалённый документ нарушила бы FK и сорвала бы публикацию
        const existing =
          candidateLinks.length > 0
            ? await tx.document.findMany({
                where: { id: { in: candidateLinks } },
                select: { id: true },
              })
            : [];
        const links = existing.map((d) => d.id);

        await tx.documentLink.deleteMany({
          where: { sourceDocId: documentId },
        });
        if (links.length > 0) {
          await tx.documentLink.createMany({
            data: links.map((targetId) => ({
              sourceDocId: documentId,
              targetDocId: targetId,
            })),
            skipDuplicates: true, // Защита от дублей на уровне БД
          });
        }
        return { version, links };
      },
      { timeout: 15_000 },
    );

    // 5. После коммита ставим эмбеддинг в очередь. Если Redis недоступен, публикация всё равно
    // успешна; задачу подхватит reconcile/backfill (embeddedVersion < publishedVersion).
    const embeddingQueued = this.queue
      ? await this.queue.enqueueEmbedDocument({ documentId, version })
      : false;

    return {
      success: true,
      message: 'Document published successfully',
      version,
      extractedLinksCount: links.length,
      embeddingQueued,
    };
  }

  /** Published HTML/text: rendered from Yjs when there is a state, else the client HTML. */
  private resolvePublishedContent(
    documentId: string,
    yjsState: Uint8Array | null,
    clientHtml: string | undefined,
  ): { html: string; text: string } {
    if (yjsState) {
      try {
        return renderYjsState(yjsState);
      } catch (err) {
        this.logger.error(
          `[Publish] Yjs render failed for doc ${documentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        if (clientHtml === undefined) {
          throw new InternalServerErrorException(
            'Could not render the document for publishing',
          );
        }
      }
    }
    if (clientHtml === undefined) {
      throw new BadRequestException(
        'Document has no content yet; open it in the editor first',
      );
    }
    // Санитизация: в БД попадает только HTML из белого списка (защита от stored XSS)
    const html = sanitizeDocumentHtml(clientHtml);
    return { html, text: htmlToPlainText(html) };
  }

  /** Published versions of a document, newest first (readers: OWNER/EDITOR/VIEWER). */
  async listVersions(documentId: string, userId: string) {
    await this.permissions.assertDocumentRole(userId, documentId, Role.VIEWER);
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { version: 'desc' },
      take: DocumentService.VERSION_LIST_LIMIT,
      select: {
        version: true,
        title: true,
        createdAt: true,
        author: { select: { id: true, email: true } },
      },
    });
    return versions;
  }

  /** One published version incl. its frozen HTML. */
  async getVersion(documentId: string, version: number, userId: string) {
    await this.permissions.assertDocumentRole(userId, documentId, Role.VIEWER);
    const found = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
      select: {
        version: true,
        title: true,
        contentHtml: true,
        createdAt: true,
        author: { select: { id: true, email: true } },
      },
    });
    if (!found) throw new NotFoundException('Version not found');
    return found;
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

  /**
   * Takes a document out of the trash (OWNERs and admins only; `assertDocumentOwner` also sees
   * archived rows). Descendants restore with it only when they were archived at the very same
   * moment (equal `archivedAt`), so documents the user archived separately stay in the trash.
   * Returns how many documents were restored.
   *
   * 409 when the document is not archived, or when its space is: a document restored inside an
   * archived space would show up in recent/graph/search while its space is hidden, so the
   * space has to be restored first.
   */
  async restoreDocument(
    documentId: string,
    userId: string,
  ): Promise<{ restored: number }> {
    // assertDocumentRole hides archived documents, hence the OWNER check that does not (as remove).
    const doc = await this.permissions.assertDocumentOwner(
      userId,
      documentId,
      'Only OWNERs can restore this document',
    );
    if (!doc.isArchived) {
      throw new ConflictException('Document is not archived');
    }
    if (doc.space.isArchived) {
      throw new ConflictException(
        'The space of this document is archived; restore the space first',
      );
    }

    const archivedAt = doc.archivedAt;
    const restore = { isArchived: false, archivedAt: null };

    return this.prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: documentId }, data: restore });
      let restored = 1;

      // Walk down the hierarchy level by level; restored rows no longer match, so it terminates.
      let level = [documentId];
      while (archivedAt && level.length > 0) {
        const children = await tx.document.findMany({
          where: { parentId: { in: level }, isArchived: true, archivedAt },
          select: { id: true },
        });
        if (children.length === 0) break;
        level = children.map((child) => child.id);
        await tx.document.updateMany({
          where: { id: { in: level } },
          data: restore,
        });
        restored += level.length;
      }
      return { restored };
    });
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
