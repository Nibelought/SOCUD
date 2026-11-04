import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { SpaceModule } from './space/space.module';
import { DocumentModule } from './document/document.module';
import { HocuspocusModule } from './hocuspocus/hocuspocus.module'; // ИМПОРТ

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    SpaceModule,
    DocumentModule,
    HocuspocusModule, // РЕГИСТРАЦИЯ МОДУЛЯ
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
