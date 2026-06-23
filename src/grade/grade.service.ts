import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { GeminiService, AiPart } from '../shared/gemini/gemini.service';
import { gradingResultSchema, GradingResult } from './grade.schema';
import { Exam } from '../quiz/quiz.schema';

const DB_DIR = 'database';

const GRADE_PROMPT =
  'Bạn là giám khảo. Các ảnh đính kèm là BÀI LÀM của MỘT thí sinh ' +
  '(có thể nhiều trang/nhiều ảnh — đọc TẤT CẢ). Bạn được cung cấp ĐÁP ÁN của ' +
  'đề (danh sách: id câu, loại câu, đáp án đúng) ở phần ĐÁP ÁN bên dưới.\n\n' +
  'BƯỚC 1 — TRÍCH XUẤT thông tin thí sinh từ ảnh (quy chuẩn):\n' +
  '  - fullName: họ tên thí sinh.\n' +
  '  - parentName: tên bố/mẹ.\n' +
  '  - parentPhone: số điện thoại bố/mẹ (CHỈ giữ chữ số).\n' +
  '  - className: lớp.\n' +
  '  - examCode: mã đề ghi trên bài làm.\n\n' +
  'BƯỚC 2 — CHẤM:\n' +
  '  - Với mỗi câu theo id trong ĐÁP ÁN, đọc câu trả lời thí sinh trên ảnh ' +
  '(studentAnswer, quy chuẩn: trắc nghiệm ghi chữ cái A/B/C/D in hoa).\n' +
  '  - So studentAnswer với correctAnswer; đúng → isCorrect=true, mỗi câu 1 điểm.\n' +
  '  - totalQuestions = số câu trong ĐÁP ÁN; correctCount = số câu đúng.\n\n' +
  'Thiếu thông tin nào thì để "" và ghi lý do vào note.';

/** Câu hỏi tối giản dùng để chấm (không gồm nội dung đề). */
interface MinimalQuestion {
  id: string;
  type: string;
  correctAnswer: string;
}

/** Một file đáp án (.json) trong database/ đã được parse. */
interface AnswerKey {
  file: string;
  title: string;
  examCode: string;
  questions: MinimalQuestion[];
}

/** Ảnh bài làm đã tải về dạng base64. */
export interface GradeImage {
  base64: string;
  mime: string;
}

/** Kết quả chấm trả ra cho caller (Discord). */
export interface GradeOutput {
  // Thông tin thí sinh trích từ ảnh.
  fullName: string;
  parentName: string;
  parentPhone: string;
  className: string;
  extractedExamCode: string; // mã đề AI đọc từ ảnh (đối chiếu)
  // Kết quả chấm.
  score: string; // "9/12"
  correctCount: number;
  totalQuestions: number;
  questions: GradingResult['questions'];
  matchedFile: string; // file đáp án dùng để chấm
  note: string;
}

@Injectable()
export class GradeService {
  private readonly logger = new Logger(GradeService.name);

  constructor(private readonly gemini: GeminiService) {}

  /** Đọc toàn bộ file .json trong database/ thành danh sách đáp án tối giản. */
  private async loadAnswerKeys(): Promise<AnswerKey[]> {
    const dir = resolve(DB_DIR);
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) =>
        n.toLowerCase().endsWith('.json'),
      );
    } catch {
      names = [];
    }
    const keys: AnswerKey[] = [];
    for (const name of names) {
      try {
        const raw = await readFile(resolve(dir, name), 'utf8');
        const exam = JSON.parse(raw) as Exam;
        keys.push({
          file: name,
          title: exam.title ?? '',
          examCode: (exam.examCode ?? '').toUpperCase(),
          // Chỉ giữ id + type + correctAnswer (không tải nội dung đề).
          questions: (exam.questions ?? []).map((q) => ({
            id: q.id,
            type: q.type,
            correctAnswer: q.correctAnswer,
          })),
        });
      } catch (err) {
        this.logger.warn(
          `Bỏ qua file đáp án lỗi "${name}": ${(err as Error).message}`,
        );
      }
    }
    return keys;
  }

  /**
   * Danh sách đề hiện có (cho dropdown /grading). Mỗi mã đề 1 mục, đã khử trùng.
   */
  async listExams(): Promise<{ examCode: string; title: string }[]> {
    const keys = await this.loadAnswerKeys();
    const seen = new Set<string>();
    const out: { examCode: string; title: string }[] = [];
    for (const k of keys) {
      if (!k.examCode || seen.has(k.examCode)) continue;
      seen.add(k.examCode);
      out.push({ examCode: k.examCode, title: k.title });
    }
    return out;
  }

  /**
   * Chấm bài làm theo mã đề nhập tay: chọn đúng file đáp án, gửi đáp án tối
   * giản + ảnh cho Gemini trong MỘT lần gọi. Ném lỗi nếu không tìm thấy đề.
   */
  async grade(examCode: string, images: GradeImage[]): Promise<GradeOutput> {
    const wanted = examCode.trim().toUpperCase();
    const keys = await this.loadAnswerKeys();
    if (keys.length === 0) {
      throw new Error(
        'Chưa có đáp án (.json) nào trong database/. Dùng /add-quiz tạo đề trước khi chấm.',
      );
    }

    const key = keys.find((k) => k.examCode === wanted);
    if (!key) {
      const available = keys.map((k) => k.examCode || '(?)').join(', ');
      throw new Error(
        `Không tìm thấy đề mã "${examCode}". Mã đề hiện có: ${available}.`,
      );
    }

    // Đáp án tối giản (minify): chỉ id + type + correctAnswer.
    const answerKeyJson = JSON.stringify(key.questions);

    // filePart nhận Buffer; GeminiService tự quyết định upload File API (ảnh
    // > 2MB) hay nhúng inline, và tự dọn asset sau khi chấm xong.
    const parts: AiPart[] = [
      this.gemini.textPart(`${GRADE_PROMPT}\n\n=== ĐÁP ÁN ===\n${answerKeyJson}`),
      ...images.map((img, i) =>
        this.gemini.filePart(
          Buffer.from(img.base64, 'base64'),
          img.mime,
          `grade-${key.examCode}-${i}`,
        ),
      ),
    ];

    this.logger.log(
      `Chấm mã đề ${key.examCode} (file ${key.file}): ${images.length} ảnh, ${key.questions.length} câu, gọi Gemini...`,
    );
    const result = await this.gemini.extractStructured(
      gradingResultSchema,
      parts,
      { name: 'grading' },
    );

    const score = `${result.correctCount}/${result.totalQuestions}`;
    this.logger.log(
      `Chấm xong: thí sinh="${result.fullName}" lớp="${result.className}" ` +
        `mã đề ảnh=${result.examCode} (nhập tay=${key.examCode}) điểm=${score}`,
    );

    return {
      fullName: result.fullName,
      parentName: result.parentName,
      parentPhone: result.parentPhone,
      className: result.className,
      extractedExamCode: result.examCode,
      score,
      correctCount: result.correctCount,
      totalQuestions: result.totalQuestions,
      questions: result.questions,
      matchedFile: key.file,
      note: result.note,
    };
  }
}
