import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { GeminiService, AiPart } from '../shared/gemini/gemini.service';
import { examSchema, Exam } from './quiz.schema';

const DB_DIR = 'database';
const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const QUIZ_PROMPT =
  'Bạn là trợ giảng. Đây là một ĐỀ THI/BÀI TẬP. Hãy GIẢI toàn bộ đề và xuất ' +
  'CẤU TRÚC đề theo schema. Với MỖI câu hỏi, xác định:\n' +
  '  - id: số thứ tự câu (vd "1").\n' +
  '  - type: loại câu — "multiple_choice" (trắc nghiệm A/B/C/D), ' +
  '"fill_blank" (điền ô trống), hoặc "error_correction" (sửa lỗi).\n' +
  '  - question: nội dung đề bài.\n' +
  '  - options: danh sách lựa chọn nếu là trắc nghiệm, [] nếu không.\n' +
  '  - correctAnswer: đáp án đúng đã quy chuẩn (trắc nghiệm ghi chữ cái + nội dung).\n' +
  '  - explanation: lời giải ngắn gọn.\n' +
  'title là tên đề; examCode là mã đề ghi trên đề (vd "A01").';

export interface QuizResult {
  title: string;
  examCode: string;
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
    let inputPart: AiPart;
    if (mimeType === PDF_MIME) {
      this.logger.log(
        `Quiz: PDF "${originalName}" (${buffer.length} bytes) → media part`,
      );
      inputPart = this.gemini.mediaPart(buffer.toString('base64'), PDF_MIME);
    } else if (mimeType === DOCX_MIME) {
      const { value: text } = await mammoth.extractRawText({ buffer });
      this.logger.log(
        `Quiz: DOCX "${originalName}" → ${text.length} ký tự text`,
      );
      if (!text.trim()) throw new Error('DOCX rỗng hoặc không trích được text');
      inputPart = this.gemini.textPart(`Nội dung đề (từ DOCX):\n\n${text}`);
    } else {
      throw new Error(`Định dạng không hỗ trợ: ${mimeType}`);
    }

    // 2) Gọi Gemini trích cấu trúc đề (structured).
    const exam: Exam = await this.gemini.extractStructured(
      examSchema,
      [this.gemini.textPart(QUIZ_PROMPT), inputPart],
      { name: 'exam' },
    );
    this.logger.log(
      `Quiz trích xong: title="${exam.title}" examCode="${exam.examCode}" câu=${exam.questions.length}`,
    );

    // 3) Lưu JSON (minified) vào database/.
    const savedPath = await this.save(exam, originalName);
    return {
      title: exam.title,
      examCode: exam.examCode,
      questionCount: exam.questions.length,
      savedPath,
      originalName,
    };
  }

  private async save(exam: Exam, originalName: string): Promise<string> {
    const dir = resolve(DB_DIR);
    await mkdir(dir, { recursive: true });
    // Tên đề theo cấu trúc rcv-<mã đề>; cùng mã đề → ghi đè (cập nhật).
    const slug =
      this.slugify(exam.examCode) ||
      this.slugify(exam.title) ||
      this.slugify(originalName) ||
      'exam';
    const filePath = resolve(dir, `rcv-${slug}.json`);
    // Minify để tiết kiệm dung lượng.
    await writeFile(filePath, JSON.stringify(exam), 'utf8');
    this.logger.log(`Quiz đã lưu: ${filePath}`);
    return filePath;
  }

  private slugify(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // bỏ dấu tiếng Việt (combining marks)
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}
