import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { SpaceModule } from './space/space.module';
import { DocumentModule } from './document/document.module';
import { QueueModule } from './queue/queue.module';
import { HocuspocusModule } from './hocuspocus/hocuspocus.module'; // ИМПОРТ

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Global default per-IP limit; stricter limits are set with @Throttle on auth routes.
    // Only applies to Nest HTTP routes: Hocuspocus runs its own WebSocket server.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    PrismaModule,
    AuthModule,
    SpaceModule,
    DocumentModule,
    QueueModule,
    HocuspocusModule, // РЕГИСТРАЦИЯ МОДУЛЯ
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
