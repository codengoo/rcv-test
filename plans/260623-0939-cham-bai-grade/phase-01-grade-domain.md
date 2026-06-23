# Phase 01 — Grade domain (module `grade/`)

**Goal:** Có module `grade/` độc lập: đọc tất cả file đáp án `.md` trong `database/`, ghép vào prompt, gọi Gemini đọc ảnh bài làm + tự nhận mã đề + chấm điểm, trả về kết quả có cấu trúc. Chưa đụng tới Discord.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/grade/grade.schema.ts | CREATE |
| src/grade/grade.service.ts | CREATE |
| src/grade/grade.module.ts | CREATE |

## 2. src/grade/grade.schema.ts
```ts
import { z } from 'zod';

/** Kết quả AI chấm bài làm. KHÔNG dùng .nullable() (Gemini response_schema reject). */
export const gradeResultSchema = z.object({
  maDe: z
    .string()
    .describe('Mã đề đọc được ghi trên bài làm của thí sinh; "" nếu không thấy'),
  totalQuestions: z
    .number()
    .describe('Tổng số câu của đề tương ứng trong kho đáp án'),
  correctCount: z
    .number()
    .describe('Số câu thí sinh làm đúng so với đáp án'),
  perQuestion: z
    .array(
      z.object({
        cau: z.number().describe('Số thứ tự câu'),
        dapAnChon: z
          .string()
          .describe('Đáp án thí sinh chọn/ghi trên bài; "" nếu bỏ trống'),
        dapAnDung: z.string().describe('Đáp án đúng theo kho đáp án'),
        dung: z.boolean().describe('true nếu thí sinh làm đúng câu này'),
      }),
    )
    .describe('Chi tiết chấm từng câu'),
  note: z
    .string()
    .describe('Ghi chú ngắn (vd không đọc được mã đề, ảnh mờ); "" nếu không có'),
});

export type GradeResult = z.infer<typeof gradeResultSchema>;
```

## 3. src/grade/grade.service.ts
```ts
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { GeminiService, AiPart } from '../shared/gemini/gemini.service';
import { gradeResultSchema, GradeResult } from './grade.schema';

const DB_DIR = 'database';

const GRADE_PROMPT =
  'Bạn là giám khảo chấm bài. Các ảnh đính kèm là BÀI LÀM của MỘT thí sinh ' +
  '(có thể nhiều trang/nhiều ảnh — đọc tất cả). Quy trình:\n' +
  '1) Đọc "Mã đề" ghi trên bài làm.\n' +
  '2) Trong KHO ĐÁP ÁN bên dưới, chọn đề có MÃ ĐỀ trùng khớp.\n' +
  '3) Đối chiếu từng câu: đáp án thí sinh chọn vs đáp án đúng + chỉ dẫn chấm; ' +
  'mỗi câu đúng tính 1 điểm.\n' +
  '4) Trả về theo schema: maDe, totalQuestions (tổng số câu của đề đó), ' +
  'correctCount (số câu đúng), perQuestion (chi tiết từng câu), note.\n' +
  'Nếu không đọc được mã đề hoặc không có đề khớp, hãy chọn đề phù hợp nhất, ' +
  'vẫn chấm và ghi lý do vào note.';

/** Một file đáp án trong database/ đã được parse. */
interface AnswerKey {
  file: string;
  maDe: string;
  title: string;
  content: string;
}

/** Ảnh bài làm đã tải về dạng base64. */
export interface GradeImage {
  base64: string;
  mime: string;
}

/** Kết quả chấm trả ra cho caller (Discord). */
export interface GradeOutput {
  maDe: string;
  score: string; // "9/12"
  correctCount: number;
  totalQuestions: number;
  perQuestion: GradeResult['perQuestion'];
  matchedFile: string; // file đáp án khớp mã đề; "" nếu không khớp
  note: string;
}

@Injectable()
export class GradeService {
  private readonly logger = new Logger(GradeService.name);

  constructor(private readonly gemini: GeminiService) {}

  /** Đọc toàn bộ file .md trong database/ thành danh sách đáp án. */
  private async loadAnswerKeys(): Promise<AnswerKey[]> {
    const dir = resolve(DB_DIR);
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) =>
        n.toLowerCase().endsWith('.md'),
      );
    } catch {
      names = [];
    }
    const keys: AnswerKey[] = [];
    for (const name of names) {
      const content = await readFile(resolve(dir, name), 'utf8');
      keys.push({
        file: name,
        maDe: this.parseMaDe(content) || name,
        title: this.parseTitle(content) || name,
        content,
      });
    }
    return keys;
  }

  private parseMaDe(content: string): string {
    const m = content.match(/M[ãa]\s*đề\s*[:\-]?\s*([A-Za-z0-9]+)/i);
    return m ? m[1].toUpperCase() : '';
  }

  private parseTitle(content: string): string {
    const m = content.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : '';
  }

  /**
   * Chấm bài làm: nạp đáp án, gọi Gemini đọc ảnh + tự nhận mã đề + chấm.
   * Ném lỗi nếu database/ chưa có đáp án nào.
   */
  async grade(images: GradeImage[]): Promise<GradeOutput> {
    const keys = await this.loadAnswerKeys();
    if (keys.length === 0) {
      throw new Error(
        'Chưa có đáp án nào trong database/. Dùng /add-quiz tạo đề trước khi chấm.',
      );
    }

    const keysBlock = keys
      .map((k) => `### MÃ ĐỀ: ${k.maDe} (file: ${k.file})\n${k.content}`)
      .join('\n\n---\n\n');

    const parts: AiPart[] = [
      this.gemini.textPart(`${GRADE_PROMPT}\n\n=== KHO ĐÁP ÁN ===\n${keysBlock}`),
      ...images.map((img) => this.gemini.imagePart(img.base64, img.mime)),
    ];

    this.logger.log(
      `Chấm: ${images.length} ảnh, ${keys.length} đề trong kho, gọi Gemini...`,
    );
    const result = await this.gemini.extractStructured(gradeResultSchema, parts, {
      name: 'grade',
    });

    const matched = keys.find(
      (k) => k.maDe === (result.maDe || '').toUpperCase(),
    );
    const score = `${result.correctCount}/${result.totalQuestions}`;
    this.logger.log(
      `Chấm xong: mã đề=${result.maDe} điểm=${score} (file khớp: ${matched?.file ?? 'không khớp'})`,
    );

    return {
      maDe: result.maDe,
      score,
      correctCount: result.correctCount,
      totalQuestions: result.totalQuestions,
      perQuestion: result.perQuestion,
      matchedFile: matched?.file ?? '',
      note: result.note,
    };
  }
}
```

## 4. src/grade/grade.module.ts
```ts
import { Module } from '@nestjs/common';
import { GradeService } from './grade.service';
import { GeminiModule } from '../shared/gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  providers: [GradeService],
  exports: [GradeService],
})
export class GradeModule {}
```

## 5. Encapsulation / wiring notes
- `GradeService` chỉ phụ thuộc `GeminiService` (qua `GeminiModule`) — không import Discord, không import Sheets. Việc tải ảnh từ URL và ghi sheet do `DiscordService` làm ở Phase 02.
- `GradeModule` `exports` `GradeService` để `DiscordModule` import (Phase 02).
- Model AI mặc định lấy từ `GeminiService` (`gemini-2.5-flash-lite`) — không override ở đây.
- Đọc `database/` qua `fs/promises` giống `QuizService` (cùng dùng path `resolve('database')`).

## 6. Acceptance criteria
- [ ] `npm run typecheck` (tsc --noEmit) pass — không lỗi type ở `grade/`.
- [ ] 3 file mới tồn tại đúng nội dung trên.
- [ ] `GradeModule` export `GradeService`; chưa được import ở đâu (Phase 02 mới wire) → không lỗi DI lúc build.

## 7. Out of scope (phase này)
- Không tải ảnh từ URL (Discord làm ở Phase 02).
- Không ghi Google Sheet.
- Không đăng ký slash command.

## 8. Commit message dự kiến
```
feat(grade): add GradeService to read answer keys and grade exam images

New grade/ module: loads all database/*.md answer keys, builds one Gemini
prompt with student answer images, auto-detects mã đề and scores each
question (1 point/câu). Returns {maDe, score "n/total", perQuestion, note}.
Generic Gemini/Sheets untouched; Discord wiring comes next phase.
```
