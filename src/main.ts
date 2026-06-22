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
  await app.init();
  Logger.log('App started', 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
