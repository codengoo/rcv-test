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

const QUIZ_MD_PROMPT =
  'Bạn là trợ giảng. Đây là một ĐỀ THI/BÀI TẬP. Hãy GIẢI toàn bộ đề và xuất ' +
  'kết quả dưới dạng MARKDOWN sạch, dễ đọc. Với mỗi câu: ghi số câu, đề bài, ' +
  'các lựa chọn (nếu có), **Đáp án** đúng và *Lời giải* ngắn gọn. Mở đầu bằng ' +
  'tiêu đề đề và mã đề (nếu có). Chỉ xuất Markdown, không kèm giải thích thừa.';

export interface QuizResult {
  title: string;
  examCode: string;
  questionCount: number;
  savedPath: string; // file .json (đáp án để chấm)
  mdPath: string; // file .md (bản giải gốc)
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

  /**
   * Luồng /add-quiz: AI giải đề → Markdown (text tự do, không bị cắt vỡ JSON),
   * rồi PARSE cục bộ thành Exam và lưu cả .md (bản giải) lẫn .json (đáp án chấm).
   */
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

    // 2) AI giải đề → Markdown.
    const md = await this.gemini.generateText([
      this.gemini.textPart(QUIZ_MD_PROMPT),
      inputPart,
    ]);
    const mdPath = await this.saveMarkdown(md, originalName);

    // 3) Convert Markdown → Exam (thuần regex) và lưu .json để chấm.
    const exam = this.parseMarkdownToExam(md);
    this.logger.log(
      `Quiz (MD→JSON): title="${exam.title}" examCode="${exam.examCode}" câu=${exam.questions.length}`,
    );
    const savedPath = await this.save(exam, originalName);

    return {
      title: exam.title,
      examCode: exam.examCode,
      questionCount: exam.questions.length,
      savedPath,
      mdPath,
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

  /** Lưu Markdown (test) vào database/ với tên rcv-<slug tên file>.md. */
  private async saveMarkdown(md: string, originalName: string): Promise<string> {
    const dir = resolve(DB_DIR);
    await mkdir(dir, { recursive: true });
    const slug = this.slugify(originalName) || 'exam';
    const filePath = resolve(dir, `rcv-${slug}.md`);
    await writeFile(filePath, md, 'utf8');
    this.logger.log(`Quiz (MD) đã lưu: ${filePath}`);
    return filePath;
  }

  /**
   * Parse Markdown (do QUIZ_MD_PROMPT sinh) thành Exam — THUẦN regex, không AI.
   * Format kỳ vọng:
   *   # <title>            (dòng tiêu đề, 1 dấu #)
   *   Mã đề: <examCode>
   *   ### Câu <id>
   *   **Đề bài:** ...      (có thể nhiều dòng)
   *   A. ... / B. ...      (lựa chọn, nếu là trắc nghiệm)
   *   **Đáp án:** ...      (có thể nhiều dòng)
   *   *Lời giải:* ...
   * Khoan dung với dòng thừa; ráp text nhiều dòng vào field đang mở.
   */
  parseMarkdownToExam(md: string): Exam {
    const lines = md.split(/\r?\n/);
    const reTitle = /^#\s+(.*)$/;
    const reExamCode = /^\s*Mã đề\s*[:：]\s*(.*)$/i;
    const reHeading = /^#{2,4}\s*Câu\s*(.+?)\s*$/i;
    const reQuestion = /^\s*\*\*\s*Đề bài\s*[:：]?\s*\*\*\s*(.*)$/i;
    const reAnswer = /^\s*\*\*\s*Đáp án\s*[:：]?\s*\*\*\s*(.*)$/i;
    const reExplain = /^\s*\*+\s*Lời giải\s*[:：]?\s*\*+\s*(.*)$/i;
    const reOption = /^\s*([A-DĐ])[.)]\s*(.*)$/;
    const reSep = /^\s*-{3,}\s*$/;

    let title = '';
    let examCode = '';
    const questions: Exam['questions'][number][] = [];

    // Bộ tích lũy cho câu đang dựng.
    let cur: {
      id: string;
      question: string[];
      options: string[];
      answer: string[];
      explanation: string[];
    } | null = null;
    let field: 'question' | 'answer' | 'explanation' | null = null;

    const flush = () => {
      if (!cur) return;
      const options = cur.options.map((o) => o.trim()).filter(Boolean);
      const answerRaw = cur.answer.join('\n').trim();
      questions.push({
        id: cur.id.trim(),
        type: this.inferType(options, cur.question.join(' '), answerRaw),
        question: cur.question.join('\n').trim(),
        options,
        correctAnswer: this.normalizeAnswer(answerRaw, options),
        explanation: cur.explanation.join('\n').trim(),
      });
      cur = null;
      field = null;
    };

    for (const line of lines) {
      if (reSep.test(line)) continue;

      const mHeading = reHeading.exec(line);
      if (mHeading) {
        flush();
        cur = { id: mHeading[1], question: [], options: [], answer: [], explanation: [] };
        field = null;
        continue;
      }

      // Trước câu đầu tiên: bắt title + mã đề.
      if (!cur) {
        const mTitle = reTitle.exec(line);
        if (mTitle && !title) {
          title = mTitle[1].replace(/^ĐỀ THI\/BÀI TẬP\s*[:：]?\s*/i, '').trim();
          continue;
        }
        const mCode = reExamCode.exec(line);
        if (mCode && !examCode) examCode = mCode[1].trim();
        continue;
      }

      const mQ = reQuestion.exec(line);
      if (mQ) {
        field = 'question';
        if (mQ[1].trim()) cur.question.push(mQ[1].trim());
        continue;
      }
      const mA = reAnswer.exec(line);
      if (mA) {
        field = 'answer';
        if (mA[1].trim()) cur.answer.push(mA[1].trim());
        continue;
      }
      const mE = reExplain.exec(line);
      if (mE) {
        field = 'explanation';
        if (mE[1].trim()) cur.explanation.push(mE[1].trim());
        continue;
      }
      const mO = reOption.exec(line);
      if (mO && field !== 'answer' && field !== 'explanation') {
        cur.options.push(`${mO[1].toUpperCase()}. ${mO[2].trim()}`);
        continue;
      }

      // Dòng văn bản thường → nối vào field đang mở.
      if (!line.trim()) continue;
      if (field === 'question') cur.question.push(line.trim());
      else if (field === 'answer') cur.answer.push(line.trim());
      else if (field === 'explanation') cur.explanation.push(line.trim());
    }
    flush();

    // Validate để chắc khớp schema (mọi field bắt buộc đều đã có).
    return examSchema.parse({ title, examCode, questions });
  }

  /** Suy ra loại câu khi parse MD (không có field type tường minh). */
  private inferType(
    options: string[],
    question: string,
    answer: string,
  ): string {
    if (options.length >= 2) return 'multiple_choice';
    const text = `${question} ${answer}`.toLowerCase();
    if (/(sửa|lỗi sai|gạch chân)/.test(text)) return 'error_correction';
    if (/(điền|còn thiếu|chỗ trống|ô trống)/.test(text)) return 'fill_blank';
    return 'fill_blank';
  }

  /**
   * Quy chuẩn đáp án: nếu là 1 chữ cái (A/B/C/D) và có options, ghép nội dung
   * lựa chọn tương ứng để khớp quy ước "B. Con ếch".
   */
  private normalizeAnswer(answer: string, options: string[]): string {
    const m = /^([A-D])\b[.)]?\s*$/i.exec(answer.trim());
    if (m && options.length) {
      const letter = m[1].toUpperCase();
      const opt = options.find((o) => o.toUpperCase().startsWith(`${letter}.`));
      if (opt) return opt;
    }
    return answer;
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
