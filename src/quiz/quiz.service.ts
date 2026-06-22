import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { GeminiService, AiPart } from '../shared/gemini/gemini.service';
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
    let inputPart: AiPart;
    if (mimeType === PDF_MIME) {
      this.logger.log(
        `Quiz: PDF "${originalName}" (${buffer.length} bytes) → media part`,
      );
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

  private async save(
    solution: QuizSolution,
    originalName: string,
  ): Promise<string> {
    const dir = resolve(DB_DIR);
    await mkdir(dir, { recursive: true });
    const slug =
      this.slugify(solution.title) || this.slugify(originalName) || 'quiz';
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = resolve(dir, `${slug}-${ts}.md`);
    const header =
      `<!-- nguồn: ${originalName} | câu: ${solution.questionCount} -->\n` +
      `# ${solution.title || originalName}\n\n`;
    await writeFile(filePath, header + solution.markdown, 'utf8');
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
