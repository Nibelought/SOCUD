import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { parseCorsOrigins } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());
  app.use(cookieParser());

  // Активация строгой валидации
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Отсекать поля, которых нет в DTO
      forbidNonWhitelisted: true, // Выдавать ошибку 400, если есть лишние поля
      transform: true, // Автоматически приводить типы (например, string "1" к числу)
    }),
  );

  // CORS: разрешены только origin-ы из CORS_ORIGIN (список через запятую)
  app.enableCors({
    origin: parseCorsOrigins(config.getOrThrow<string>('CORS_ORIGIN')),
    credentials: true, // refresh-токен живёт в httpOnly cookie
  });

  await app.listen(config.getOrThrow<number>('PORT'));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
