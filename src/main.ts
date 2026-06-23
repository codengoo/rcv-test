import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    // Bật debug/verbose để thấy log từng bước (mặc định Nest ẩn 2 mức này).
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  // Dev: FE Vite (5173) gọi API (3000) khác origin → bật CORS. Prod cùng origin.
  app.enableCors();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`App started — HTTP server listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
