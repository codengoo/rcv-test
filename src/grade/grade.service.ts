import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { GeminiService, AiPart } from '../shared/gemini/gemini.service';
import { gradeResultSchema, GradeResult } from './grade.schema';

const DB_DIR = 'database';

const GRADE_PROMPT =
  'Bạn là giám khảo. Các ảnh đính kèm là BÀI LÀM của MỘT thí sinh ' +
  '(có thể nhiều trang/nhiều ảnh — đọc TẤT CẢ).\n\n' +
  'BƯỚC 1 — TRÍCH XUẤT (quy chuẩn) thông tin từ ảnh:\n' +
  '  - hoTen: họ tên thí sinh.\n' +
  '  - boMe: tên bố/mẹ (phụ huynh).\n' +
  '  - sdtBoMe: số điện thoại bố/mẹ (CHỈ giữ chữ số).\n' +
  '  - lop: lớp.\n' +
  '  - maDe: mã đề ghi trên bài làm.\n' +
  '  - câu trả lời từng câu (quy chuẩn: trắc nghiệm ghi chữ cái A/B/C/D in hoa; ' +
  'tự luận ghi nội dung ngắn gọn).\n\n' +
  'BƯỚC 2 — ĐỐI CHIẾU & CHẤM:\n' +
  '  - Trong KHO ĐÁP ÁN bên dưới, chọn đề có MÃ ĐỀ trùng với maDe vừa đọc.\n' +
  '  - So câu trả lời thí sinh với đáp án đúng + chỉ dẫn chấm; mỗi câu đúng 1 điểm.\n' +
  '  - Điền perQuestion {cau, dapAnChon (câu trả lời thí sinh), dapAnDung, dung}, ' +
  'totalQuestions (tổng số câu của đề đó), correctCount (số câu đúng).\n\n' +
  'Thiếu thông tin nào thì để "" và ghi lý do vào note. Nếu không đọc được mã đề ' +
  'hoặc không có đề khớp, chọn đề phù hợp nhất, vẫn chấm và ghi lý do vào note.';

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
  // Thông tin thí sinh trích từ ảnh.
  hoTen: string;
  boMe: string;
  sdtBoMe: string;
  lop: string;
  maDe: string;
  // Kết quả chấm.
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
    console.log(keys);
    
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
      `Chấm xong: thí sinh="${result.hoTen}" lớp="${result.lop}" mã đề=${result.maDe} ` +
        `điểm=${score} (file khớp: ${matched?.file ?? 'không khớp'})`,
    );

    return {
      hoTen: result.hoTen,
      boMe: result.boMe,
      sdtBoMe: result.sdtBoMe,
      lop: result.lop,
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
