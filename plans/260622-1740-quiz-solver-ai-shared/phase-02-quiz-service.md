# Phase 02 — QuizModule + QuizService (solve + save)

**Goal:** Có `src/quiz/` với `QuizService.solveAndSave(buffer, mimeType, originalName)` → parse PDF/DOCX thành AI part, gọi `gemini.extractStructured(quizSolutionSchema)`, lưu `markdown` vào `database/<slug>-<timestamp>.md`, trả `{ title, questionCount, savedPath, originalName }`. Chưa wire slash command.

## 1. Files chạm vào
| File | Action |
|---|---|
| package.json | MODIFY (+`mammoth`) |
| src/quiz/quiz.schema.ts | CREATE |
| src/quiz/quiz.service.ts | CREATE |
| src/quiz/quiz.module.ts | CREATE |
| .gitignore | MODIFY (+`database/`) |

## 2. Cài dependency
```
npm install mammoth@^1.8.0
```

## 3. src/quiz/quiz.schema.ts
```typescript
import { z } from 'zod';

/** Output AI khi giải đề. KHÔNG dùng .nullable() (Gemini response_schema reject). */
export const quizSolutionSchema = z.object({
  title: z.string().describe('Tên/tiêu đề của đề thi; "" nếu không xác định'),
  questionCount: z.number().describe('Tổng số câu hỏi đã giải trong đề'),
  markdown: z
    .string()
    .describe(
      'Toàn bộ lời giải dạng Markdown thân thiện với agent: mỗi câu gồm số câu, ' +
        'đề tóm tắt, đáp án đúng, và chỉ dẫn chấm điểm (rubric) rõ ràng',
    ),
});

export type QuizSolution = z.infer<typeof quizSolutionSchema>;
```

## 4. src/quiz/quiz.service.ts
```typescript
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { GeminiService } from '../shared/gemini/gemini.service';
import { quizSolutionSchema, QuizSolution } from './quiz.schema';

const DB_DIR = 'database';
const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const QUIZ_PROMPT =
  'Bạn là trợ giảng. Đây là một ĐỀ THI/BÀI TẬP. Hãy GIẢI toàn bộ đề và xuất ' +
  'kết quả theo schema. markdown phải thân thiện với agent chấm bài: với MỖI câu ' +
  'ghi rõ "## Câu N", tóm tắt đề, **Đáp án**, lời giải ngắn gọn, và "**Chỉ dẫn chấm**" ' +
  '(rubric: cho điểm thế nào, các lỗi thường gặp). title là tên đề; questionCount là số câu đã giải.';

export interface QuizResult {
  title: string;
  questionCount: number;
  savedPath: string;
  originalName: string;
}

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(private readonly gemini: GeminiService) {}

  /** true nếu mime được hỗ trợ (pdf/docx). */
  isSupported(mimeType: string): boolean {
    return mimeType === PDF_MIME || mimeType === DOCX_MIME;
  }

  async solveAndSave(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
  ): Promise<QuizResult> {
    // 1) Dựng input part theo định dạng.
    let inputPart;
    if (mimeType === PDF_MIME) {
      this.logger.log(`Quiz: PDF "${originalName}" (${buffer.length} bytes) → media part`);
      inputPart = this.gemini.mediaPart(buffer.toString('base64'), PDF_MIME);
    } else if (mimeType === DOCX_MIME) {
      const { value: text } = await mammoth.extractRawText({ buffer });
      this.logger.log(`Quiz: DOCX "${originalName}" → ${text.length} ký tự text`);
      if (!text.trim()) throw new Error('DOCX rỗng hoặc không trích được text');
      inputPart = this.gemini.textPart(`Nội dung đề (từ DOCX):\n\n${text}`);
    } else {
      throw new Error(`Định dạng không hỗ trợ: ${mimeType}`);
    }

    // 2) Gọi Gemini giải đề (structured).
    const solution: QuizSolution = await this.gemini.extractStructured(
      quizSolutionSchema,
      [this.gemini.textPart(QUIZ_PROMPT), inputPart],
      { name: 'quiz' },
    );
    this.logger.log(
      `Quiz giải xong: title="${solution.title}" questionCount=${solution.questionCount}`,
    );

    // 3) Lưu markdown vào database/.
    const savedPath = await this.save(solution, originalName);
    return {
      title: solution.title,
      questionCount: solution.questionCount,
      savedPath,
      originalName,
    };
  }

  private async save(solution: QuizSolution, originalName: string): Promise<string> {
    const dir = resolve(DB_DIR);
    await mkdir(dir, { recursive: true });
    const slug =
      this.slugify(solution.title) || this.slugify(originalName) || 'quiz';
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = resolve(dir, `${slug}-${ts}.md`);
    const header = `<!-- nguồn: ${originalName} | câu: ${solution.questionCount} -->\n# ${solution.title || originalName}\n\n`;
    await writeFile(filePath, header + solution.markdown, 'utf8');
    this.logger.log(`Quiz đã lưu: ${filePath}`);
    return filePath;
  }

  private slugify(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}
```
> `mammoth` không có sẵn type? Nó kèm `mammoth.d.ts`. Nếu thiếu type cho `extractRawText`, dùng `import mammoth = require('mammoth')` hoặc `(mammoth as any)`.

## 5. src/quiz/quiz.module.ts
```typescript
import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { GeminiModule } from '../shared/gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  providers: [QuizService],
  exports: [QuizService],
})
export class QuizModule {}
```

## 6. .gitignore — thêm
```
database/
```

## 7. Encapsulation / wiring notes
- `QuizService` chỉ gọi Gemini qua `GeminiService` (shared), KHÔNG import LangChain trực tiếp.
- Parse file (mammoth) thuộc domain quiz → nằm trong QuizService.
- QuizModule `imports: [GeminiModule]`, `exports: [QuizService]` để DiscordModule dùng ở phase 03.
- Không đụng DiscordService ở phase này.

## 8. Acceptance criteria
- [ ] `npm install` xong, `mammoth` trong package.json.
- [ ] `npm run typecheck` pass.
- [ ] `npm run build` pass; `dist/quiz/quiz.service.js` tồn tại.
- [ ] (Smoke, optional với key thật) gọi `QuizService.solveAndSave` qua script tạm với 1 PDF nhỏ → tạo file trong `database/`.

## 9. Out of scope (phase này)
- Slash command + interaction (phase 03).
- Hỗ trợ .doc/.txt/ảnh.

## 10. Commit message dự kiến
```
feat(quiz): add QuizService solve exam + save markdown

Module src/quiz/: quizSolutionSchema {title, questionCount, markdown} +
QuizService.solveAndSave parse PDF (media part) / DOCX (mammoth text),
gọi GeminiService.extractStructured giải đề, lưu markdown vào database/.
Thêm dep mammoth; gitignore database/.
```
