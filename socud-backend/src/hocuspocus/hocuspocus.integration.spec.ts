/**
 * Integration test: a real Hocuspocus server (random port) and real HocuspocusProvider clients.
 * Only the database layer (PrismaService, DocumentService.verifyDocumentAccess) is mocked.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/*
 * `@hocuspocus/server` loads `crossws/adapters/node`, which is ESM-only. Node 22 can require()
 * it, but Jest's CommonJS module system cannot. Only this thin WebSocket upgrade adapter is
 * replaced (by an equivalent built directly on `ws`, mirroring how crossws drives the hooks);
 * Hocuspocus itself, its hooks and the HocuspocusService under test are the real code.
 */
jest.mock('crossws/adapters/node', () => {
  const { WebSocketServer } = jest.requireActual<typeof import('ws')>('ws');
  interface Peer {
    websocket: import('ws').WebSocket;
    request: Request;
    _hocuspocus?: unknown;
  }
  interface Hooks {
    open(peer: Peer): void;
    message(peer: Peer, message: { uint8Array(): Uint8Array }): void;
    close(peer: Peer, event: { code: number; reason: string }): void;
    error(peer: Peer, error: Error): void;
  }
  return {
    __esModule: true,
    default: (options: {
      hooks: Hooks;
      serverOptions?: Record<string, unknown>;
    }) => {
      const wss = new WebSocketServer({
        noServer: true,
        ...options.serverOptions,
      });
      return {
        handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
          wss.handleUpgrade(req, socket, head, (websocket) => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (value !== undefined)
                headers.set(key, [value].flat().join(', '));
            }
            const peer: Peer = {
              websocket,
              request: new Request(`http://${req.headers.host}${req.url}`, {
                headers,
              }),
            };
            options.hooks.open(peer);
            websocket.on('message', (data: Buffer) =>
              options.hooks.message(peer, {
                uint8Array: () => new Uint8Array(data),
              }),
            );
            websocket.on('close', (code, reason) =>
              options.hooks.close(peer, { code, reason: reason.toString() }),
            );
            websocket.on('error', (error) => options.hooks.error(peer, error));
          });
        },
      };
    },
  };
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Role } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import { DocumentService } from '../document/document.service';
import { PrismaService } from '../prisma/prisma.service';
import { createConfigServiceMock, TEST_ENV } from '../test-utils/mocks';
import { HocuspocusService } from './hocuspocus.service';

// Typical run is ~3 s in total; the generous limits only matter on a heavily loaded machine.
jest.setTimeout(20_000);

const DOC_ID = 'doc-1';
const JWT_SECRET = TEST_ENV.JWT_SECRET as string;
const EDITOR_1 = 'editor-1';
const EDITOR_2 = 'editor-2';
const VIEWER_1 = 'viewer-1';
const STRANGER = 'stranger-1';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
    await sleep(10);
  }
}

const sign = (userId: string, options: jwt.SignOptions = {}) =>
  jwt.sign({ sub: userId }, JWT_SECRET, { algorithm: 'HS256', ...options });

describe('HocuspocusService (integration, real WebSocket)', () => {
  let service: HocuspocusService;
  let providers: HocuspocusProvider[];
  let roles: Map<string, Role>;
  let stored: Uint8Array | null;
  let prisma: {
    document: { findUnique: jest.Mock; update: jest.Mock };
  };
  let documentService: {
    verifyDocumentAccess: jest.Mock;
    registerLiveStateProvider: jest.Mock;
  };

  async function startServer(recheckMs: number) {
    const config = createConfigServiceMock({
      WS_PORT: 0,
      ACCESS_RECHECK_MS: recheckMs,
      WS_STORE_DEBOUNCE_MS: 20,
    });
    service = new HocuspocusService(
      prisma as unknown as PrismaService,
      documentService as unknown as DocumentService,
      config,
    );
    await service.start();
  }

  /** Connects a client and waits until it is authenticated and synced. */
  async function connect(token: string, waitUntilSynced = true) {
    const document = new Y.Doc();
    const failures: string[] = [];
    const closes: string[] = [];
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${service.port}`,
      name: DOC_ID,
      token,
      document,
      onAuthenticationFailed: ({ reason }) => failures.push(reason),
      onClose: ({ event }) => closes.push(event.reason),
    });
    providers.push(provider);
    if (waitUntilSynced) {
      await waitFor(() => provider.isSynced, 'provider to sync');
    }
    return {
      provider,
      document,
      text: document.getText('t'),
      failures,
      closes,
    };
  }

  const persistedText = () => {
    if (!stored) return null;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, stored);
    return doc.getText('t').toJSON();
  };

  beforeEach(() => {
    providers = [];
    stored = null;
    roles = new Map([
      [EDITOR_1, Role.EDITOR],
      [EDITOR_2, Role.OWNER],
      [VIEWER_1, Role.VIEWER],
    ]);
    prisma = {
      document: {
        findUnique: jest.fn().mockResolvedValue({ yjsState: null }),
        update: jest.fn((args: { data: { yjsState: Buffer } }) => {
          stored = args.data.yjsState;
          return Promise.resolve({});
        }),
      },
    };
    documentService = {
      registerLiveStateProvider: jest.fn(),
      verifyDocumentAccess: jest.fn(
        (_docId: string, userId: string, required: Role[]) => {
          const role = roles.get(userId);
          if (!role) return Promise.reject(new NotFoundException());
          return required.includes(role)
            ? Promise.resolve({ id: DOC_ID })
            : Promise.reject(new ForbiddenException());
        },
      ),
    };
  });

  afterEach(async () => {
    for (const provider of providers) provider.destroy();
    await service?.stop();
  });

  describe('read-only enforcement (S6)', () => {
    beforeEach(() => startServer(60_000));

    it('lets a VIEWER read but drops their edits', async () => {
      const editor = await connect(sign(EDITOR_1));
      const viewer = await connect(sign(VIEWER_1));
      const owner = await connect(sign(EDITOR_2));

      expect(editor.provider.authorizedScope).toBe('read-write');
      expect(viewer.provider.authorizedScope).toBe('readonly');

      // The viewer is connected and receives the editor's changes ...
      editor.text.insert(0, 'from-editor');
      await waitFor(
        () => viewer.text.toJSON() === 'from-editor',
        'viewer to receive the editor edit',
      );

      // ... but their own edit must not reach the server, other clients or the database.
      viewer.text.insert(viewer.text.length, '|from-viewer');
      await sleep(300);
      editor.text.insert(editor.text.length, '|more');
      await waitFor(
        () => persistedText() === 'from-editor|more',
        'second editor edit to be persisted',
      );

      expect(owner.text.toJSON()).toBe('from-editor|more');
      expect(editor.text.toJSON()).toBe('from-editor|more');
      expect(persistedText()).not.toContain('from-viewer');
      expect(persistedText()).toBe('from-editor|more');
    });

    it('propagates an EDITOR edit to other clients and persists it', async () => {
      const editor = await connect(sign(EDITOR_1));
      const owner = await connect(sign(EDITOR_2));

      editor.text.insert(0, 'hello');
      await waitFor(
        () => owner.text.toJSON() === 'hello',
        'second editor to receive the edit',
      );
      await waitFor(
        () => persistedText() === 'hello',
        'onStoreDocument to persist the edit',
      );

      expect(prisma.document.findUnique).toHaveBeenCalledWith({
        where: { id: DOC_ID },
        select: { yjsState: true },
      });
      expect(prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DOC_ID },
          data: expect.objectContaining({ updatedBy: EDITOR_1 }) as unknown,
        }),
      );
    });

    it('renders draft HTML and text from the Yjs state when storing', async () => {
      const editor = await connect(sign(EDITOR_1));
      // What the editor's Collaboration extension writes: <paragraph>Hello draft</paragraph>.
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('Hello draft')]);
      editor.document.getXmlFragment('default').insert(0, [paragraph]);

      await waitFor(
        () =>
          prisma.document.update.mock.calls.some(
            (c: [{ data: { draftHtml?: string } }]) =>
              c[0].data.draftHtml === '<p>Hello draft</p>',
          ),
        'onStoreDocument to render the draft',
      );
      expect(prisma.document.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            draftHtml: '<p>Hello draft</p>',
            draftText: 'Hello draft',
          }) as unknown,
        }),
      );
    });

    it('still persists the Yjs state when the draft cannot be rendered', async () => {
      const editor = await connect(sign(EDITOR_1));
      editor.document
        .getXmlFragment('default')
        .insert(0, [new Y.XmlElement('notInTheSchema')]);

      await waitFor(
        () => prisma.document.update.mock.calls.length > 0,
        'onStoreDocument to persist',
      );
      const data = (
        prisma.document.update.mock.calls.at(-1) as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data.yjsState).toBeInstanceOf(Buffer);
      expect(data).not.toHaveProperty('draftHtml');
    });

    it('exposes the live in-memory state to Publish', async () => {
      const editor = await connect(sign(EDITOR_1));
      editor.text.insert(0, 'live');
      await waitFor(
        () => prisma.document.update.mock.calls.length > 0,
        'first store',
      );

      const [provider] = documentService.registerLiveStateProvider.mock
        .calls[0] as [(id: string) => Uint8Array | null];
      expect(provider('unknown-doc')).toBeNull();
      const live = new Y.Doc();
      Y.applyUpdate(live, provider(DOC_ID)!);
      expect(live.getText('t').toJSON()).toBe('live');
    });

    it('loads the persisted state for new clients', async () => {
      const seed = new Y.Doc();
      seed.getText('t').insert(0, 'persisted');
      prisma.document.findUnique.mockResolvedValue({
        yjsState: Y.encodeStateAsUpdate(seed),
      });

      const viewer = await connect(sign(VIEWER_1));
      expect(viewer.text.toJSON()).toBe('persisted');
    });

    it('rejects invalid, expired and unauthorised tokens', async () => {
      const wrongSecret = jwt.sign({ sub: EDITOR_1 }, 'x'.repeat(40));
      const expired = sign(EDITOR_1, { expiresIn: -10 });
      const noAccess = sign(STRANGER);

      const clients = await Promise.all(
        [wrongSecret, expired, noAccess, 'not-a-jwt'].map((token) =>
          connect(token, false),
        ),
      );
      await waitFor(
        () => clients.every((c) => c.failures.length > 0),
        'every bad token to be rejected',
      );

      for (const client of clients) {
        expect(client.provider.isAuthenticated).toBe(false);
        expect(client.provider.isSynced).toBe(false);
      }
      // The document is only loaded after a successful authentication.
      expect(prisma.document.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('throttling', () => {
    it('does not re-check access on every message', async () => {
      await startServer(60_000);
      const editor = await connect(sign(EDITOR_1));
      const callsAfterConnect =
        documentService.verifyDocumentAccess.mock.calls.length;
      expect(callsAfterConnect).toBe(1);

      for (let i = 0; i < 50; i++) editor.text.insert(0, 'x');
      await waitFor(
        () => persistedText() === 'x'.repeat(50),
        'burst of edits to be persisted',
      );

      expect(documentService.verifyDocumentAccess).toHaveBeenCalledTimes(
        callsAfterConnect,
      );
    });
  });

  describe('access re-validation (S8)', () => {
    const RECHECK_MS = 200;
    beforeEach(() => startServer(RECHECK_MS));

    it('closes the connection of a user whose access was removed', async () => {
      const editor = await connect(sign(EDITOR_1));
      const owner = await connect(sign(EDITOR_2));
      editor.text.insert(0, 'before');
      await waitFor(() => owner.text.toJSON() === 'before', 'initial sync');

      roles.delete(EDITOR_1);
      // Must happen within about one interval (+ sweep granularity), not "eventually" (the
      // default re-check interval is 15 s, so a generic timeout would not prove this).
      await waitFor(
        () => editor.closes.includes('access-revoked'),
        'revoked connection to be closed',
        RECHECK_MS * 10,
      );
      expect(editor.provider.isAuthenticated).toBe(false);

      // Edits made after the revocation never reach the others or the database.
      editor.text.insert(editor.text.length, '|after');
      owner.text.insert(owner.text.length, '|owner');
      await waitFor(
        () => persistedText() === 'before|owner',
        'owner edit to be persisted',
      );
      await sleep(200);
      expect(owner.text.toJSON()).toBe('before|owner');
      expect(persistedText()).toBe('before|owner');
    });

    it('closes the connection when the document disappears or is archived', async () => {
      const viewer = await connect(sign(VIEWER_1));
      // DocumentService throws NotFoundException for archived documents.
      documentService.verifyDocumentAccess.mockRejectedValue(
        new NotFoundException('Document not found'),
      );
      await waitFor(
        () => viewer.closes.includes('access-revoked'),
        'connection to be closed',
        RECHECK_MS * 4 + 1000,
      );
    });

    it('switches an EDITOR downgraded to VIEWER to read-only without dropping them', async () => {
      const editor = await connect(sign(EDITOR_1));
      const owner = await connect(sign(EDITOR_2));
      editor.text.insert(0, 'a');
      await waitFor(() => owner.text.toJSON() === 'a', 'initial sync');

      roles.set(EDITOR_1, Role.VIEWER);
      // The next edit after the interval triggers the re-check (message path).
      await sleep(RECHECK_MS + 100);
      editor.text.insert(editor.text.length, 'b');
      await sleep(300);

      owner.text.insert(owner.text.length, 'c');
      await waitFor(() => persistedText() === 'ac', 'owner edit persisted');

      expect(owner.text.toJSON()).toBe('ac');
      expect(editor.closes).toHaveLength(0);
      expect(editor.text.toJSON()).toContain('b'); // only their local view has it
      expect(persistedText()).toBe('ac');
    });

    it('closeConnectionsForDocument force-closes all clients of that document', async () => {
      const editor = await connect(sign(EDITOR_1));
      const viewer = await connect(sign(VIEWER_1));

      service.closeConnectionsForDocument(DOC_ID);

      await waitFor(
        () => editor.closes.length > 0 && viewer.closes.length > 0,
        'both clients to be closed',
      );
    });
  });
});
