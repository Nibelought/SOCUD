import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Server } from '@hocuspocus/server';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentService } from '../document/document.service';
import { Role } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import * as Y from 'yjs';

@Injectable()
export class HocuspocusService implements OnModuleInit, OnModuleDestroy {
  private server: Server;
  private readonly logger = new Logger(HocuspocusService.name);

  constructor(
    private prisma: PrismaService,
    private documentService: DocumentService,
  ) {}

  async onModuleInit() {
    this.server = new Server({
      port: 3002, // FIX: Выделенный порт только для WebSockets
      debounce: 2000,

      onConnect: async (data) => {
        this.logger.log(`[1] onConnect: Received handshake for doc: ${data.documentName}`);
      },

      onAuthenticate: async (data) => {
        this.logger.log(`[2] onAuthenticate: Verifying token...`);
        const token = data.token;
        if (!token) throw new Error('Missing token');

        try {
          const secret = process.env.JWT_SECRET;
          const rawToken = token.replace('Bearer ', '').trim();
          const decoded = jwt.verify(rawToken, secret as string) as jwt.JwtPayload;
          const userId = decoded.sub as string;
          let isReadOnly = false;

          try {
            await this.documentService.verifyDocumentAccess(data.documentName, userId, [Role.OWNER, Role.EDITOR]);
          } catch (e) {
            await this.documentService.verifyDocumentAccess(data.documentName, userId, [Role.VIEWER]);
            isReadOnly = true;
          }

          if (isReadOnly) (data as any).connection.readOnly = true;
          this.logger.log(`[3] Auth SUCCESS | User: ${userId} | ReadOnly: ${isReadOnly}`);
          return { user: { id: userId } };
        } catch (err: any) {
          this.logger.error(`[3] Auth FAILED: ${err.message}`);
          throw new Error('Unauthorized');
        }
      },

      onLoadDocument: async (data) => {
        this.logger.log(`[4] onLoadDocument: Fetching from DB...`);
        const doc = await this.prisma.document.findUnique({
          where: { id: data.documentName },
          select: { yjsState: true }
        });

        if (doc?.yjsState) {
          Y.applyUpdate(data.document, doc.yjsState);
          this.logger.log(`[4.1] DB Loaded (${doc.yjsState.length} bytes)`);
        } else {
          this.logger.log(`[4.1] DB is empty (New Doc)`);
        }
        return data.document;
      },

      onChange: async (data) => {
        this.logger.log(`[5] onChange: Editor typing detected.`);
        if (data.context.user) {
          (data.document as any).__lastEditorId = data.context.user.id;
        }
      },

      onStoreDocument: async (data) => {
        this.logger.log(`[6] onStoreDocument: Saving to DB...`);
        try {
          const updatedBy = (data.document as any).__lastEditorId;
          const stateBuffer = Buffer.from(Y.encodeStateAsUpdate(data.document));

          await this.prisma.document.update({
            where: { id: data.documentName },
            data: {
              yjsState: stateBuffer,
              ...(updatedBy && { updatedBy }),
            }
          });
          this.logger.log(`[7] SAVED SUCCESSFULLY`);
        } catch (error: any) {
          this.logger.error(`[7] SAVE FAILED: ${error.message}`);
        }
      }
    });

    // Нативный запуск сервера
    await this.server.listen();
    this.logger.log('🚀 Hocuspocus WS Server running natively on ws://127.0.0.1:3002');
  }

  async onModuleDestroy() {
    await this.server.destroy();
  }
}