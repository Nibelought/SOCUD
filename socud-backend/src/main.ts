import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { parseCorsOrigins } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

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
  });

  await app.listen(config.getOrThrow<number>('PORT'));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
