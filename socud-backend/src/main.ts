import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Активация строгой валидации
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Отсекать поля, которых нет в DTO
      forbidNonWhitelisted: true, // Выдавать ошибку 400, если есть лишние поля
      transform: true, // Автоматически приводить типы (например, string "1" к числу)
    }),
  );

  // Включение CORS для будущей работы с Frontend
  app.enableCors();

  await app.listen(3000);
}
bootstrap();
