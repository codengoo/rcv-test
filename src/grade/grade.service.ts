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
      this.gemini.textPart(
        `${GRADE_PROMPT}\n\n=== KHO ĐÁP ÁN ===\n${keysBlock}`,
      ),
      ...images.map((img) => this.gemini.imagePart(img.base64, img.mime)),
    ];

    this.logger.log(
      `Chấm: ${images.length} ảnh, ${keys.length} đề trong kho, gọi Gemini...`,
    );
    const result = await this.gemini.extractStructured(
      gradeResultSchema,
      parts,
      { name: 'grade' },
    );

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
