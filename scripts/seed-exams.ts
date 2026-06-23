import 'reflect-metadata';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '../src/config/env.validation';
import { ExamModule } from '../src/exam/exam.module';
import { ExamService } from '../src/exam/exam.service';
import { examSchema } from '../src/quiz/quiz.schema';

const DB_DIR = 'database';

/**
 * Module tối giản chỉ để seed: ConfigModule (validate env) + Mongoose + ExamModule.
 * KHÔNG nạp DiscordModule nên không đăng nhập bot khi chạy seed.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ExamModule,
  ],
})
class SeedModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn', 'log'],
  });
  const exams = app.get(ExamService);

  const dir = resolve(DB_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith('.json'));
  } catch {
    names = [];
  }

  if (names.length === 0) {
    console.warn(`Không tìm thấy file .json nào trong ${dir}/ để seed.`);
    await app.close();
    return;
  }

  let ok = 0;
  let skipped = 0;
  for (const name of names) {
    try {
      const raw = await readFile(resolve(dir, name), 'utf8');
      const exam = examSchema.parse(JSON.parse(raw));
      const code = (exam.examCode || '').trim().toUpperCase();
      if (!code) {
        console.warn(`Bỏ qua "${name}": thiếu examCode.`);
        skipped++;
        continue;
      }
      await exams.upsertByExamCode({
        examCode: code,
        title: exam.title,
        questions: exam.questions,
      });
      console.log(`✓ Seed ${code} từ ${name} (${exam.questions.length} câu)`);
      ok++;
    } catch (err) {
      console.warn(`Bỏ qua file lỗi "${name}": ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(`Seed xong: ${ok} đề upsert, ${skipped} bỏ qua.`);
  await app.close();
}

main().catch((err) => {
  console.error('Seed thất bại:', err);
  process.exit(1);
});
