import { Injectable, Logger } from '@nestjs/common';
import { GeminiService, AiPart } from '../shared/gemini/gemini.service';
import { gradingResultSchema } from './grade.schema';
import { ExamService } from '../exam/exam.service';

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

/** Ảnh bài làm đã tải về dạng base64. */
export interface GradeImage {
  base64: string;
  mime: string;
}

/** Một câu đã chấm, kèm nội dung đề join từ Exam (cho submission/FE). */
export interface GradedQuestion {
  id: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  type: string; // loại câu (carry từ Exam) — FE hiển thị
  earnedPoints: number; // isCorrect ? 1 : 0 lúc chấm tự động
  question: string;
  options: string[];
  explanation: string;
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
  examCode: string; // mã đề đã dùng để chấm (nhập tay, uppercase)
  score: string; // "9/12"
  correctCount: number;
  totalQuestions: number;
  totalScore: number; // = correctCount (mỗi câu 1đ) lúc chấm tự động
  maxScore: number; // = totalQuestions
  questions: GradedQuestion[];
  matchedFile: string; // nguồn đáp án dùng để chấm (mô tả)
  note: string;
}

@Injectable()
export class GradeService {
  private readonly logger = new Logger(GradeService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly exams: ExamService,
  ) {}

  /**
   * Danh sách đề hiện có (cho dropdown /grading). Đọc từ Mongo qua ExamService.
   */
  async listExams(): Promise<{ examCode: string; title: string }[]> {
    return this.exams.listExams();
  }

  /**
   * Chấm bài làm theo mã đề nhập tay: lấy đề từ Mongo, gửi đáp án tối giản +
   * ảnh cho Gemini trong MỘT lần gọi, rồi join nội dung đề (question/options/
   * explanation) vào từng câu đã chấm. Ném lỗi nếu không tìm thấy đề.
   */
  async grade(examCode: string, images: GradeImage[]): Promise<GradeOutput> {
    const wanted = examCode.trim().toUpperCase();
    const exam = await this.exams.findForGrading(wanted);
    if (!exam) {
      const available = (await this.exams.listExams())
        .map((e) => e.examCode || '(?)')
        .join(', ');
      throw new Error(
        `Không tìm thấy đề mã "${examCode}". Mã đề hiện có: ${available || '(trống)'}.`,
      );
    }

    // Đáp án tối giản (minify): chỉ id + type + correctAnswer.
    const answerKeyJson = JSON.stringify(
      exam.questions.map((q) => ({
        id: q.id,
        type: q.type,
        correctAnswer: q.correctAnswer,
      })),
    );

    // filePart nhận Buffer; GeminiService tự quyết định upload File API (ảnh
    // > 2MB) hay nhúng inline, và tự dọn asset sau khi chấm xong.
    const parts: AiPart[] = [
      this.gemini.textPart(`${GRADE_PROMPT}\n\n=== ĐÁP ÁN ===\n${answerKeyJson}`),
      ...images.map((img, i) =>
        this.gemini.filePart(
          Buffer.from(img.base64, 'base64'),
          img.mime,
          `grade-${exam.examCode}-${i}`,
        ),
      ),
    ];

    this.logger.log(
      `Chấm mã đề ${exam.examCode} (Mongo): ${images.length} ảnh, ${exam.questions.length} câu, gọi Gemini...`,
    );
    const result = await this.gemini.extractStructured(
      gradingResultSchema,
      parts,
      { name: 'grading', thinkingBudget: 0 },
    );

    // Join nội dung đề vào từng câu đã chấm (theo id) cho submission/FE.
    const byId = new Map(exam.questions.map((q) => [q.id, q]));
    const questions: GradedQuestion[] = result.questions.map((q) => {
      const src = byId.get(q.id);
      return {
        id: q.id,
        studentAnswer: q.studentAnswer,
        correctAnswer: src?.correctAnswer ?? '',
        isCorrect: q.isCorrect,
        type: src?.type ?? '',
        earnedPoints: q.isCorrect ? 1 : 0,
        question: src?.question ?? '',
        options: src?.options ?? [],
        explanation: src?.explanation ?? '',
      };
    });

    const score = `${result.correctCount}/${result.totalQuestions}`;
    this.logger.log(
      `Chấm xong: thí sinh="${result.fullName}" lớp="${result.className}" ` +
        `mã đề ảnh=${result.examCode} (nhập tay=${exam.examCode}) điểm=${score}`,
    );

    return {
      fullName: result.fullName,
      parentName: result.parentName,
      parentPhone: result.parentPhone,
      className: result.className,
      extractedExamCode: result.examCode,
      examCode: exam.examCode,
      score,
      correctCount: result.correctCount,
      totalQuestions: result.totalQuestions,
      totalScore: result.correctCount,
      maxScore: result.totalQuestions,
      questions,
      matchedFile: `mongo:exams/${exam.examCode}`,
      note: result.note,
    };
  }
}
