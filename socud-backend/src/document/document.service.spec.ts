import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
import * as Y from 'yjs';
import { LiveDocumentRegistry } from '../pipeline/live-document.registry';
import { QueueService } from '../queue/queue.service';
import { SERVER_EXTENSIONS, YJS_FRAGMENT_NAME } from '../pipeline/yjs-render';
import { DocumentService } from './document.service';
import { PermissionService } from '../permission/permission.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createConfigServiceMock,
  createPrismaServiceMock,
} from '../test-utils/mocks';

const m = (fn: unknown) => fn as jest.Mock;

/** Yjs state of a one-paragraph document, built with the real editor schema. */
function yjsStateOf(text: string): Uint8Array {
  const ydoc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(
    getSchema(SERVER_EXTENSIONS),
    {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
    ydoc.getXmlFragment(YJS_FRAGMENT_NAME),
  );
  return Y.encodeStateAsUpdate(ydoc);
}

describe('DocumentService', () => {
  let service: DocumentService;
  let prisma: jest.Mocked<PrismaService>;
  let fetchMock: jest.SpyInstance;
  let queue: { enqueueEmbedDocument: jest.Mock };
  let live: LiveDocumentRegistry;

  async function build(configOverrides: Record<string, unknown> = {}) {
    queue = { enqueueEmbedDocument: jest.fn().mockResolvedValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        PermissionService,
        { provide: QueueService, useValue: queue },
        LiveDocumentRegistry,
        { provide: PrismaService, useValue: createPrismaServiceMock() },
        {
          provide: ConfigService,
          useValue: createConfigServiceMock(configOverrides),
        },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    live = module.get(LiveDocumentRegistry);
    prisma = module.get(PrismaService);
    m(prisma.$transaction).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
    m(prisma.document.update).mockResolvedValue({
      publishedVersion: 3,
      title: 'Doc title',
    });
    m(prisma.document.findMany).mockResolvedValue([]);
  }

  /** Space OWNER of an existing, non-archived document. */
  function allowPublish() {
    m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: false });
    m(prisma.document.findUnique).mockResolvedValue({
      id: 'doc',
      isArchived: false,
      members: [],
      space: { members: [{ role: 'OWNER' }] },
    });
  }

  beforeEach(async () => {
    await build();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('AI worker down'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('returns the view fields including isArchived', async () => {
      allowPublish();
      const updatedAt = new Date();
      m(prisma.document.findUnique).mockResolvedValue({
        id: 'doc',
        title: 'T',
        contentHtml: '<p>x</p>',
        updatedAt,
        isArchived: false,
        spaceId: 'space',
        members: [],
        space: { name: 'Space', members: [{ role: 'VIEWER' }] },
      });

      await expect(service.findOne('doc', 'user')).resolves.toEqual({
        id: 'doc',
        title: 'T',
        contentHtml: '<p>x</p>',
        updatedAt,
        isArchived: false,
        spaceId: 'space',
        space: { name: 'Space' },
      });
    });
  });

  describe('getKnowledgeGraph', () => {
    const graphRow = {
      nodes: [{ id: 'a', name: 'A', group: 's', spaceName: 'S' }],
      links: [{ source: 'a', target: 'a' }],
      truncated: false,
    };
    const sqlOf = () => {
      const [sql] = m(prisma.$queryRaw).mock.calls[0] as [Prisma.Sql];
      return sql;
    };

    it('returns the nodes, links and truncated flag computed by the database', async () => {
      m(prisma.$queryRaw).mockResolvedValue([graphRow]);
      await expect(service.getKnowledgeGraph('user')).resolves.toEqual(
        graphRow,
      );
    });

    it('is an empty, untruncated graph when the query returns no row', async () => {
      m(prisma.$queryRaw).mockResolvedValue([]);
      await expect(service.getKnowledgeGraph('user')).resolves.toEqual({
        nodes: [],
        links: [],
        truncated: false,
      });
    });

    it('filters access and edges in SQL with bound parameters, never a JS id list', async () => {
      m(prisma.$queryRaw).mockResolvedValue([graphRow]);
      await service.getKnowledgeGraph('user-42');

      const { sql, values } = sqlOf();
      // access filter = accessibleDocumentsSql: archived, admin, space member, document member
      expect(sql).toContain('"isArchived" = false');
      expect(sql).toContain('"SpaceMember"');
      expect(sql).toContain('"DocumentMember"');
      // both link ends must be kept nodes
      expect(sql).toMatch(/JOIN kept ks ON ks\."id" = l\."sourceDocId"/);
      expect(sql).toMatch(/JOIN kept kt ON kt\."id" = l\."targetDocId"/);
      expect(sql).not.toMatch(/\bIN\s*\(/i);
      expect(sql).not.toContain('user-42'); // parameterized, not interpolated
      expect(values).toContain('user-42');
      expect(m(prisma.document.findMany)).not.toHaveBeenCalled();
      expect(m(prisma.documentLink.findMany)).not.toHaveBeenCalled();
    });

    it('defaults to 2000 nodes and probes one more row to detect truncation', async () => {
      m(prisma.$queryRaw).mockResolvedValue([graphRow]);
      await service.getKnowledgeGraph('user');
      const { values } = sqlOf();
      expect(values).toEqual(expect.arrayContaining([2001, 2000]));
    });

    it('passes the requested limit and reports truncation', async () => {
      m(prisma.$queryRaw).mockResolvedValue([{ ...graphRow, truncated: true }]);
      const graph = await service.getKnowledgeGraph('user', 10);
      expect(graph.truncated).toBe(true);
      expect(sqlOf().values).toEqual(expect.arrayContaining([11, 10]));
    });

    it.each([
      [0, 1],
      [-5, 1],
      [999_999, 5000],
    ])('clamps limit %p to %p', async (given, used) => {
      m(prisma.$queryRaw).mockResolvedValue([graphRow]);
      await service.getKnowledgeGraph('user', given);
      expect(sqlOf().values).toEqual(expect.arrayContaining([used + 1, used]));
    });
  });

  describe('restoreDocument', () => {
    const archivedAt = new Date('2026-01-01T10:00:00.000Z');
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'doc',
      isArchived: true,
      archivedAt,
      members: [],
      space: { isArchived: false, members: [{ role: 'OWNER' }] },
      ...over,
    });
    const restored = { isArchived: false, archivedAt: null };

    beforeEach(() => {
      m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: false });
      m(prisma.document.updateMany).mockResolvedValue({ count: 0 });
    });

    it('restores the document and only the descendants archived at the same moment', async () => {
      m(prisma.document.findUnique).mockResolvedValue(row());
      m(prisma.document.findMany)
        .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
        .mockResolvedValueOnce([{ id: 'g1' }])
        .mockResolvedValueOnce([]);

      await expect(service.restoreDocument('doc', 'user')).resolves.toEqual({
        restored: 4,
      });

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc' },
        data: restored,
      });
      expect(prisma.document.findMany).toHaveBeenNthCalledWith(1, {
        where: { parentId: { in: ['doc'] }, isArchived: true, archivedAt },
        select: { id: true },
      });
      expect(prisma.document.findMany).toHaveBeenNthCalledWith(2, {
        where: { parentId: { in: ['c1', 'c2'] }, isArchived: true, archivedAt },
        select: { id: true },
      });
      expect(prisma.document.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['c1', 'c2'] } },
        data: restored,
      });
    });

    it('returns 1 when nothing was archived with it', async () => {
      m(prisma.document.findUnique).mockResolvedValue(row());
      m(prisma.document.findMany).mockResolvedValue([]);
      await expect(service.restoreDocument('doc', 'user')).resolves.toEqual({
        restored: 1,
      });
      expect(prisma.document.updateMany).not.toHaveBeenCalled();
    });

    it('without an archive timestamp restores just the document', async () => {
      m(prisma.document.findUnique).mockResolvedValue(
        row({ archivedAt: null }),
      );
      await expect(service.restoreDocument('doc', 'user')).resolves.toEqual({
        restored: 1,
      });
      expect(prisma.document.findMany).not.toHaveBeenCalled();
    });

    it('409 when the document is not archived, without writing', async () => {
      m(prisma.document.findUnique).mockResolvedValue(
        row({ isArchived: false, archivedAt: null }),
      );
      await expect(service.restoreDocument('doc', 'user')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.document.update).not.toHaveBeenCalled();
    });

    it('409 when its space is archived (restore the space first)', async () => {
      m(prisma.document.findUnique).mockResolvedValue(
        row({ space: { isArchived: true, members: [{ role: 'OWNER' }] } }),
      );
      await expect(service.restoreDocument('doc', 'user')).rejects.toThrow(
        /restore the space first/,
      );
      expect(prisma.document.update).not.toHaveBeenCalled();
    });
  });

  describe('publishDocument', () => {
    const uuid = '3f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7b';

    it('stores only sanitized HTML and extracts links from the sanitized HTML', async () => {
      allowPublish();
      m(prisma.document.findMany).mockResolvedValue([{ id: uuid }]);
      const dirty =
        `<p onclick="x()">Hi <a href="/document/${uuid}">l</a>` +
        `<a href="javascript:alert('${'4f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7c'}')">bad</a></p>` +
        '<script>alert(1)</script><iframe src="https://evil.example"></iframe>';

      const result = await service.publishDocument('doc', 'user', {
        html: dirty,
      });

      const stored = (
        m(prisma.document.update).mock.calls[0][0] as {
          data: { contentHtml: string };
        }
      ).data.contentHtml;
      expect(stored).toBe(
        `<p>Hi <a href="/document/${uuid}" rel="noopener noreferrer">l</a><a rel="noopener noreferrer">bad</a></p>`,
      );
      // The UUID hidden in the dropped javascript: href must not become a link.
      expect(m(prisma.document.findMany)).toHaveBeenCalledWith({
        where: { id: { in: [uuid] } },
        select: { id: true },
      });
      expect(m(prisma.documentLink.createMany)).toHaveBeenCalledWith({
        data: [{ sourceDocId: 'doc', targetDocId: uuid }],
        skipDuplicates: true,
      });
      expect(result.extractedLinksCount).toBe(1);
    });

    it('skips links to missing/deleted documents instead of aborting the publish', async () => {
      allowPublish();
      // Only one of the two linked documents still exists.
      const gone = '4f2b8c1e-8a4d-4f5e-9b1a-2c3d4e5f6a7c';
      m(prisma.document.findMany).mockResolvedValue([{ id: uuid }]);

      const result = await service.publishDocument('doc', 'user', {
        html: `<p><a href="/document/${uuid}">a</a><a href="/document/${gone}">b</a></p>`,
      });

      expect(m(prisma.documentLink.createMany)).toHaveBeenCalledWith({
        data: [{ sourceDocId: 'doc', targetDocId: uuid }],
        skipDuplicates: true,
      });
      expect(result.success).toBe(true);
      expect(result.extractedLinksCount).toBe(1);
    });

    it('creates no links (and no createMany) when every target is stale', async () => {
      allowPublish();
      m(prisma.document.findMany).mockResolvedValue([]);

      const result = await service.publishDocument('doc', 'user', {
        html: `<p><a href="/document/${uuid}">a</a></p>`,
      });

      expect(m(prisma.documentLink.deleteMany)).toHaveBeenCalled();
      expect(m(prisma.documentLink.createMany)).not.toHaveBeenCalled();
      expect(result.extractedLinksCount).toBe(0);
    });

    it('logs only the document id, HTML length and link count, never content', async () => {
      allowPublish();
      m(prisma.document.findMany).mockResolvedValue([{ id: uuid }]);
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const secret = 'TOP-SECRET-CONTENT';

      await service.publishDocument('doc', 'user', {
        html: `<p>${secret}</p><a href="/document/${uuid}">x</a>`,
      });

      const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain(secret);
      expect(logged).not.toContain(uuid);
      expect(logged).not.toContain('<p>');
      expect(logged).toMatch(/doc.*HTML length: \d+.*Links: 1/);
    });

    it('does only DB work inside the transaction and enqueues the job after the commit', async () => {
      allowPublish();
      const order: string[] = [];
      m(prisma.$transaction).mockImplementation(
        async (cb: (tx: unknown) => unknown) => {
          const out = await cb(prisma);
          order.push('commit');
          return out;
        },
      );
      queue.enqueueEmbedDocument.mockImplementation(() => {
        order.push('enqueue');
        return Promise.resolve(true);
      });

      const result = await service.publishDocument('doc', 'user', {
        html: '<h1>Title</h1><p>A paragraph that is long enough to embed.</p>',
      });

      expect(order).toEqual(['commit', 'enqueue']);
      expect(queue.enqueueEmbedDocument).toHaveBeenCalledWith({
        documentId: 'doc',
        version: 3,
      });
      expect(result).toMatchObject({
        success: true,
        version: 3,
        embeddingQueued: true,
      });
      // No call to the AI worker from the request path.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('writes chunks with a NULL embedding (no vector in the transaction)', async () => {
      allowPublish();

      await service.publishDocument('doc', 'user', {
        html: '<h1>Title</h1><p>A paragraph that is long enough to embed.</p>',
      });

      expect(m(prisma.documentChunk.deleteMany)).toHaveBeenCalledWith({
        where: { documentId: 'doc' },
      });
      const { data } = m(prisma.documentChunk.createMany).mock.calls[0][0] as {
        data: Record<string, unknown>[];
      };
      expect(data).toEqual([
        {
          documentId: 'doc',
          chunkIndex: 0,
          textContent: expect.stringContaining('A paragraph') as string,
        },
      ]);
      expect(data[0]).not.toHaveProperty('embedding');
      expect(m(prisma.$executeRaw)).not.toHaveBeenCalled();
    });

    it('succeeds and reports embeddingQueued=false when Redis is unavailable', async () => {
      allowPublish();
      queue.enqueueEmbedDocument.mockResolvedValue(false);

      const result = await service.publishDocument('doc', 'user', {
        html: '<p>Some content that is long enough</p>',
      });

      expect(result).toMatchObject({ success: true, embeddingQueued: false });
    });

    it('does not enqueue anything when the transaction fails', async () => {
      allowPublish();
      m(prisma.$transaction).mockRejectedValue(new Error('db down'));

      await expect(
        service.publishDocument('doc', 'user', { html: '<p>x</p>' }),
      ).rejects.toThrow('db down');
      expect(queue.enqueueEmbedDocument).not.toHaveBeenCalled();
    });

    it('stores a version snapshot with author, number, html and Yjs state', async () => {
      allowPublish();
      const state = yjsStateOf('Snapshot me');
      live.setSource(() => state);

      await service.publishDocument('doc', 'author-1', {});

      const { data } = m(prisma.documentVersion.create).mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).toMatchObject({
        documentId: 'doc',
        version: 3,
        title: 'Doc title',
        createdBy: 'author-1',
        contentHtml: '<p>Snapshot me</p>',
      });
      expect(Buffer.from(data.yjsState as Uint8Array)).toEqual(
        Buffer.from(state),
      );
      expect(m(prisma.document.update)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publishedVersion: { increment: 1 },
          }) as unknown,
        }),
      );
    });

    it('renders HTML from the server-side Yjs state and ignores the client HTML', async () => {
      allowPublish();
      live.setSource(() => yjsStateOf('From the server'));

      await service.publishDocument('doc', 'user', {
        html: '<p>Client says otherwise</p>',
      });

      const { data } = m(prisma.document.update).mock.calls[0][0] as {
        data: { contentHtml: string; draftText: string };
      };
      expect(data.contentHtml).toBe('<p>From the server</p>');
      expect(data.draftText).toBe('From the server');
    });

    it('falls back to the stored Yjs state when the document is not open', async () => {
      m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: false });
      m(prisma.document.findUnique).mockResolvedValue({
        id: 'doc',
        isArchived: false,
        yjsState: Buffer.from(yjsStateOf('Persisted')),
        members: [],
        space: { members: [{ role: 'OWNER' }] },
      });
      m(prisma.document.update).mockResolvedValue({
        publishedVersion: 1,
        title: 'T',
      });

      await service.publishDocument('doc', 'user', {});

      const { data } = m(prisma.document.update).mock.calls[0][0] as {
        data: { contentHtml: string };
      };
      expect(data.contentHtml).toBe('<p>Persisted</p>');
    });

    it('rejects a publish with neither Yjs state nor client HTML', async () => {
      allowPublish();

      await expect(
        service.publishDocument('doc', 'user', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(m(prisma.$transaction)).not.toHaveBeenCalled();
    });
  });

  describe('versions', () => {
    const asRole = (role: 'OWNER' | 'EDITOR' | 'VIEWER' | null) => {
      m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: false });
      m(prisma.document.findUnique).mockResolvedValue({
        id: 'doc',
        isArchived: false,
        members: [],
        space: { members: role ? [{ role }] : [] },
      });
    };

    it.each(['OWNER', 'EDITOR', 'VIEWER'] as const)(
      'lists versions for %s (without Yjs state)',
      async (role) => {
        asRole(role);
        m(prisma.documentVersion.findMany).mockResolvedValue([
          { version: 2 },
          { version: 1 },
        ]);

        await expect(service.listVersions('doc', 'user')).resolves.toHaveLength(
          2,
        );

        const args = m(prisma.documentVersion.findMany).mock.calls[0][0] as {
          where: unknown;
          select: Record<string, unknown>;
        };
        expect(args.where).toEqual({ documentId: 'doc' });
        expect(args.select).not.toHaveProperty('yjsState');
      },
    );

    it('denies listing and reading to users without access', async () => {
      asRole(null);

      await expect(service.listVersions('doc', 'user')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.getVersion('doc', 1, 'user')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(m(prisma.documentVersion.findMany)).not.toHaveBeenCalled();
      expect(m(prisma.documentVersion.findUnique)).not.toHaveBeenCalled();
    });

    it('hides versions of archived or missing documents', async () => {
      m(prisma.user.findUnique).mockResolvedValue({ isSystemAdmin: true });
      m(prisma.document.findUnique).mockResolvedValue({
        id: 'doc',
        isArchived: true,
        members: [],
        space: { members: [] },
      });

      await expect(service.listVersions('doc', 'admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns one version, scoped to the document in the URL', async () => {
      asRole('VIEWER');
      m(prisma.documentVersion.findUnique).mockResolvedValue({
        version: 2,
        contentHtml: '<p>x</p>',
      });

      await expect(service.getVersion('doc', 2, 'user')).resolves.toEqual({
        version: 2,
        contentHtml: '<p>x</p>',
      });
      expect(m(prisma.documentVersion.findUnique)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { documentId_version: { documentId: 'doc', version: 2 } },
        }),
      );
    });

    it('404s for an unknown version number', async () => {
      asRole('VIEWER');
      m(prisma.documentVersion.findUnique).mockResolvedValue(null);

      await expect(
        service.getVersion('doc', 99, 'user'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
