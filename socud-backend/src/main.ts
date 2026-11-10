import './instrument';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { parseCorsOrigins } from './config/env.validation';
import { Logger } from 'nestjs-pino';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { isSwaggerEnabled, setupSwagger } from './openapi/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // Structured JSON logs (pino); also used for Nest's own Logger calls.
  app.useLogger(app.get(Logger));
  if (config.get<string>('SENTRY_DSN')) {
    app.useGlobalFilters(new SentryGlobalFilter(app.getHttpAdapter()));
  }

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

  // Swagger UI + JSON (off in production unless SWAGGER_ENABLED=true). After helmet(), so only the
  // docs routes get their relaxed CSP; every other route keeps the strict one.
  if (
    isSwaggerEnabled({
      SWAGGER_ENABLED: config.get<boolean>('SWAGGER_ENABLED'),
      NODE_ENV: config.get<string>('NODE_ENV'),
    })
  ) {
    setupSwagger(app);
  }

  await app.listen(config.getOrThrow<number>('PORT'));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
