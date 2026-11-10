import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  Connection,
  Server,
  type ServerConfiguration,
  type beforeHandleMessagePayload,
  type onAuthenticatePayload,
  type onConnectPayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
} from '@hocuspocus/server';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentService } from '../document/document.service';
import { Role } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import { renderYjsState } from '../pipeline/yjs-render';

/** Per-connection context: filled by `onAuthenticate`, available in every later hook. */
export interface HocuspocusContext {
  user?: { id: string };
  /** When the user's access was last verified by `onAuthenticate` (epoch ms). */
  authenticatedAt?: number;
}

type AccessLevel = 'write' | 'read';

/** Default interval between access re-validations of one connection. */
export const DEFAULT_ACCESS_RECHECK_MS = 15_000;
/** Default `onStoreDocument` debounce. */
export const DEFAULT_STORE_DEBOUNCE_MS = 2_000;

/** Sent to the client (as `close` event) when its access to the document was withdrawn. */
const ACCESS_REVOKED = { code: 4403, reason: 'access-revoked' } as const;

/**
 * Thrown from `beforeHandleMessage` after access was lost. Hocuspocus then drops the message
 * that triggered the check instead of applying it to the document.
 */
class AccessRevokedError extends Error {
  readonly code = ACCESS_REVOKED.code;
  readonly reason = ACCESS_REVOKED.reason;

  constructor() {
    super('Access to the document was revoked');
  }
}

interface AccessState {
  lastCheckedAt: number;
  pending?: Promise<void>;
  revoked: boolean;
}

@Injectable()
export class HocuspocusService implements OnModuleInit, OnModuleDestroy {
  private server?: Server<HocuspocusContext>;
  private sweeper?: NodeJS.Timeout;
  private recheckMs = DEFAULT_ACCESS_RECHECK_MS;
  private readonly accessStates = new WeakMap<Connection, AccessState>();
  private readonly logger = new Logger(HocuspocusService.name);

  constructor(
    private prisma: PrismaService,
    private documentService: DocumentService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.start();
  }

  async onModuleDestroy() {
    await this.stop();
  }

  /** Port the server is actually listening on (differs from WS_PORT when that is 0). */
  get port(): number {
    if (!this.server) throw new Error('Hocuspocus server is not started');
    return this.server.address.port;
  }

  /**
   * Force-close every connection of the document. Clients may reconnect, but then have to pass
   * `onAuthenticate` again. Call this after revoking members or archiving a document to cut
   * off sessions immediately (without waiting for the periodic re-check).
   */
  closeConnectionsForDocument(documentId: string): void {
    this.server?.hocuspocus.closeConnections(documentId);
  }

  async start(): Promise<void> {
    const wsPort = this.config.getOrThrow<number>('WS_PORT');
    const isTest = this.config.get<string>('NODE_ENV') === 'test';
    this.recheckMs = this.readPositiveNumber(
      'ACCESS_RECHECK_MS',
      DEFAULT_ACCESS_RECHECK_MS,
    );

    this.server = new Server<HocuspocusContext>(
      this.buildConfiguration(wsPort, isTest),
    );
    await this.server.listen();

    // Publish freezes the live in-memory state, not just the last debounced save.
    this.documentService.registerLiveStateProvider?.((documentId) => {
      const live = this.server?.hocuspocus.documents.get(documentId);
      return live ? Y.encodeStateAsUpdate(live) : null;
    });

    // Idle connections send no messages, so `beforeHandleMessage` alone would never notice that
    // their access was withdrawn (they would keep receiving other users' edits). Sweep them.
    this.sweeper = setInterval(
      () => this.sweepConnections(),
      Math.max(1, Math.floor(this.recheckMs / 2)),
    );
    this.sweeper.unref();

    this.logger.log(
      `Hocuspocus WS server listening on port ${this.port} (access re-check every ${this.recheckMs} ms)`,
    );
  }

  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    const server = this.server;
    this.server = undefined;
    await server?.destroy();
  }

  private buildConfiguration(
    wsPort: number,
    isTest: boolean,
  ): Partial<ServerConfiguration<HocuspocusContext>> {
    const jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');

    return {
      port: wsPort, // Выделенный порт только для WebSockets
      debounce: this.readPositiveNumber(
        'WS_STORE_DEBOUNCE_MS',
        DEFAULT_STORE_DEBOUNCE_MS,
      ),
      quiet: isTest,
      // In tests the process signal handlers that call process.exit() must not be installed.
      stopOnSignals: !isTest,

      onConnect: (data: onConnectPayload<HocuspocusContext>) => {
        this.logger.log(
          `[1] onConnect: Received handshake for doc: ${data.documentName}`,
        );
        return Promise.resolve();
      },

      onAuthenticate: async (
        data: onAuthenticatePayload<HocuspocusContext>,
      ) => {
        this.logger.log(`[2] onAuthenticate: Verifying token...`);
        const token = data.token;
        if (!token) throw new Error('Missing token');

        try {
          const rawToken = token.replace('Bearer ', '').trim();
          const decoded = jwt.verify(rawToken, jwtSecret, {
            algorithms: ['HS256'],
          }) as jwt.JwtPayload;
          const userId = decoded.sub;
          if (!userId) throw new Error('Token has no subject');

          const level = await this.resolveAccess(data.documentName, userId);
          // Hocuspocus v4 reads the read-only flag from `connectionConfig` of the authenticate
          // payload; it is copied to the Connection and announced to the client.
          data.connectionConfig.readOnly = level === 'read';

          this.logger.log(
            `[3] Auth SUCCESS | User: ${userId} | ReadOnly: ${level === 'read'}`,
          );
          return { user: { id: userId }, authenticatedAt: Date.now() };
        } catch (err: unknown) {
          this.logger.error(`[3] Auth FAILED: ${this.errorMessage(err)}`);
          throw new Error('Unauthorized');
        }
      },

      beforeHandleMessage: async (
        data: beforeHandleMessagePayload<HocuspocusContext>,
      ) => {
        // Throws AccessRevokedError (dropping the message) if access is gone.
        await this.enforceAccess(data.connection, true);
      },

      onLoadDocument: async (
        data: onLoadDocumentPayload<HocuspocusContext>,
      ) => {
        this.logger.log(`[4] onLoadDocument: Fetching from DB...`);
        const doc = await this.prisma.document.findUnique({
          where: { id: data.documentName },
          select: { yjsState: true },
        });

        if (doc?.yjsState) {
          Y.applyUpdate(data.document, doc.yjsState);
          this.logger.log(`[4.1] DB Loaded (${doc.yjsState.length} bytes)`);
        } else {
          this.logger.log(`[4.1] DB is empty (New Doc)`);
        }
        return data.document;
      },

      onStoreDocument: async (
        data: onStoreDocumentPayload<HocuspocusContext>,
      ) => {
        this.logger.log(`[5] onStoreDocument: Saving to DB...`);
        try {
          // Context of the connection that made the last change.
          const updatedBy = data.lastContext?.user?.id;
          const state = Y.encodeStateAsUpdate(data.document);

          await this.prisma.document.update({
            where: { id: data.documentName },
            data: {
              yjsState: Buffer.from(state),
              ...this.renderDraft(data.documentName, state),
              ...(updatedBy && { updatedBy }),
            },
          });
          this.logger.log(`[6] SAVED SUCCESSFULLY`);
        } catch (error: unknown) {
          this.logger.error(`[6] SAVE FAILED: ${this.errorMessage(error)}`);
        }
      },
    };
  }

  /**
   * Draft HTML/text derived from the Yjs state. A render failure must never block saving the
   * state itself (the source of truth), so it only skips the draft columns.
   */
  private renderDraft(
    documentId: string,
    state: Uint8Array,
  ): { draftHtml: string; draftText: string } | Record<string, never> {
    try {
      const { html, text } = renderYjsState(state);
      return { draftHtml: html, draftText: text };
    } catch (err: unknown) {
      this.logger.warn(
        `Draft render failed for doc ${documentId}: ${this.errorMessage(err)}`,
      );
      return {};
    }
  }

  /**
   * Current access of the user: 'write' for OWNER/EDITOR, 'read' for VIEWER.
   * Throws NotFoundException/ForbiddenException when there is none (other errors propagate).
   */
  private async resolveAccess(
    documentId: string,
    userId: string,
  ): Promise<AccessLevel> {
    try {
      await this.documentService.verifyDocumentAccess(documentId, userId, [
        Role.OWNER,
        Role.EDITOR,
      ]);
      return 'write';
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
    }
    await this.documentService.verifyDocumentAccess(documentId, userId, [
      Role.VIEWER,
    ]);
    return 'read';
  }

  /**
   * Re-validates the access of one connection, at most once per `ACCESS_RECHECK_MS`.
   * - access lost: the connection is closed (and, when `throwOnRevoke`, AccessRevokedError is
   *   thrown so the message being handled is not applied);
   * - downgraded/upgraded: `connection.readOnly` is switched in place (Hocuspocus checks it on
   *   every sync update), the connection stays open;
   * - infrastructure errors (e.g. DB down) do not drop the connection; retried after the interval.
   */
  private async enforceAccess(
    connection: Connection<HocuspocusContext>,
    throwOnRevoke: boolean,
  ): Promise<void> {
    let state = this.accessStates.get(connection);
    if (!state) {
      // Hocuspocus may deliver queued messages before any "connected" hook runs, so the state is
      // created lazily, anchored at the time of authentication.
      state = {
        lastCheckedAt: connection.context?.authenticatedAt ?? 0,
        revoked: false,
      };
      this.accessStates.set(connection, state);
    }

    if (state.revoked) {
      if (throwOnRevoke) throw new AccessRevokedError();
      return;
    }
    if (state.pending) {
      // A check is running: wait for it so this message cannot slip through.
      await state.pending;
    } else if (Date.now() - state.lastCheckedAt >= this.recheckMs) {
      state.lastCheckedAt = Date.now();
      const check = this.recheck(connection, state);
      state.pending = check;
      try {
        await check;
      } finally {
        state.pending = undefined;
      }
    }

    if (state.revoked && throwOnRevoke) throw new AccessRevokedError();
  }

  private async recheck(
    connection: Connection<HocuspocusContext>,
    state: AccessState,
  ): Promise<void> {
    const userId = connection.context?.user?.id;
    const documentName = connection.document.name;

    try {
      if (!userId) throw new ForbiddenException('Connection has no user');
      const level = await this.resolveAccess(documentName, userId);
      const readOnly = level === 'read';
      if (connection.readOnly !== readOnly) {
        this.logger.warn(
          `Access changed | User: ${userId} | Doc: ${documentName} | ReadOnly: ${readOnly}`,
        );
        connection.readOnly = readOnly;
      }
    } catch (err: unknown) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        this.logger.warn(
          `Access revoked, closing connection | User: ${userId} | Doc: ${documentName}`,
        );
        state.revoked = true;
        connection.close({ ...ACCESS_REVOKED });
        return;
      }
      this.logger.error(
        `Access re-check failed, keeping connection | Doc: ${documentName}: ${this.errorMessage(err)}`,
      );
    }
  }

  private sweepConnections(): void {
    const server = this.server;
    if (!server) return;
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        this.enforceAccess(
          connection as Connection<HocuspocusContext>,
          false,
        ).catch((err: unknown) =>
          this.logger.error(`Sweep failed: ${this.errorMessage(err)}`),
        );
      }
    }
  }

  private readPositiveNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<number | string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
