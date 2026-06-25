import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Exam, ExamDocument } from './exam.schema';

/** Đề tối giản dùng để chấm: id + type + correctAnswer + nội dung để join. */
export interface ExamForGrading {
  examCode: string;
  title: string;
  questions: {
    id: string;
    type: string;
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  }[];
}

/** Dữ liệu 1 đề để upsert (từ QuizService hoặc seed). */
export interface ExamInput {
  examCode: string;
  title: string;
  questions: {
    id: string;
    type: string;
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  }[];
}

/** Một chỉnh sửa đáp án/giải thích 1 câu (từ ExamController). */
export interface ExamAnswerEdit {
  id: string;
  correctAnswer: string;
  explanation: string;
}

/** Code 6 số ngẫu nhiên "000000".."999999" cho link sửa đề. */
function randomEditCode(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
}

/**
 * Nguồn dữ liệu đề thi trên MongoDB. QuizService ghi đề qua đây; GradeService
 * đọc đáp án qua đây (thay cho đọc database/*.json). Mọi truy cập Model nằm
 * trong service này — caller không inject Model trực tiếp.
 */
@Injectable()
export class ExamService {
  private readonly logger = new Logger(ExamService.name);

  constructor(
    @InjectModel(Exam.name) private readonly examModel: Model<ExamDocument>,
  ) {}

  /**
   * Upsert đề theo examCode (uppercase) — chạy lại không nhân bản. Đề không có
   * examCode bị từ chối (không thể định danh để chấm).
   */
  async upsertByExamCode(exam: ExamInput): Promise<ExamDocument> {
    const code = exam.examCode.trim().toUpperCase();
    if (!code) {
      throw new Error('Đề thiếu examCode — không thể lưu vào Mongo.');
    }
    // Giữ editCode cũ nếu đã có (link sửa ổn định), else sinh mới duy nhất.
    const existing = await this.examModel.findOne(
      { examCode: code },
      { editCode: 1 },
    );
    const editCode = existing?.editCode || (await this.uniqueEditCode());
    const doc = await this.examModel.findOneAndUpdate(
      { examCode: code },
      {
        $set: {
          examCode: code,
          title: exam.title ?? '',
          questions: exam.questions ?? [],
          editCode,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.logger.log(
      `Upsert đề ${code}: ${exam.questions?.length ?? 0} câu (id=${doc._id}, editCode ${editCode})`,
    );
    return doc;
  }

  /** Sinh editCode 6 số chưa dùng (retry tránh trùng). */
  private async uniqueEditCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = randomEditCode();
      if (!(await this.examModel.exists({ editCode: code }))) return code;
    }
    throw new Error('Không sinh được editCode duy nhất sau 10 lần');
  }

  /** Tìm đề theo examCode (uppercase). null nếu không có. */
  async findByExamCode(code: string): Promise<ExamDocument | null> {
    return this.examModel.findOne({ examCode: code.trim().toUpperCase() });
  }

  /** Tìm đề theo editCode 6 số (cho link sửa). null nếu sai/không có. */
  async findByEditCode(code: string): Promise<ExamDocument | null> {
    if (!/^\d{6}$/.test(code)) return null;
    return this.examModel.findOne({ editCode: code });
  }

  /**
   * Cập nhật đáp án + giải thích từng câu theo editCode (không đổi câu hỏi/
   * options, không đụng bài đã chấm). Trả null nếu sai code.
   */
  async updateAnswers(
    code: string,
    edits: ExamAnswerEdit[],
  ): Promise<ExamDocument | null> {
    const doc = await this.findByEditCode(code);
    if (!doc) return null;
    const byId = new Map(edits.map((e) => [e.id, e]));
    for (const q of doc.questions) {
      const e = byId.get(q.id);
      if (e) {
        q.correctAnswer = e.correctAnswer;
        q.explanation = e.explanation;
      }
    }
    doc.markModified('questions');
    await doc.save();
    this.logger.log(
      `Cập nhật đáp án đề ${doc.examCode} (editCode ${code}): ${edits.length} câu`,
    );
    return doc;
  }

  /** Xóa TẤT CẢ đề (cho /sync-quizzes chế độ replace). Trả số đề đã xóa. */
  async deleteAll(): Promise<number> {
    const res = await this.examModel.deleteMany({});
    const count = res.deletedCount ?? 0;
    this.logger.warn(`Đã xóa toàn bộ ${count} đề (sync replace)`);
    return count;
  }

  /** Tập mã đề (uppercase) hiện có — để /sync-quizzes lọc "chỉ thêm đề mới". */
  async existingExamCodes(): Promise<Set<string>> {
    const docs = await this.examModel.find({}, { examCode: 1 }).lean();
    return new Set(docs.map((d) => d.examCode));
  }

  /** Danh sách đề (examCode + title) cho dropdown /grading. */
  async listExams(): Promise<{ examCode: string; title: string }[]> {
    const docs = await this.examModel
      .find({}, { examCode: 1, title: 1 })
      .sort({ examCode: 1 })
      .lean();
    return docs.map((d) => ({ examCode: d.examCode, title: d.title ?? '' }));
  }

  /**
   * Đề đầy đủ (cho chấm + join nội dung vào submission). null nếu không có.
   */
  async findForGrading(code: string): Promise<ExamForGrading | null> {
    const doc = await this.examModel
      .findOne({ examCode: code.trim().toUpperCase() })
      .lean();
    if (!doc) return null;
    return {
      examCode: doc.examCode,
      title: doc.title ?? '',
      questions: (doc.questions ?? []).map((q) => ({
        id: q.id,
        type: q.type,
        question: q.question ?? '',
        options: q.options ?? [],
        correctAnswer: q.correctAnswer ?? '',
        explanation: q.explanation ?? '',
      })),
    };
  }
}
