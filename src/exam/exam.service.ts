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
    const doc = await this.examModel.findOneAndUpdate(
      { examCode: code },
      {
        $set: {
          examCode: code,
          title: exam.title ?? '',
          questions: exam.questions ?? [],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.logger.log(
      `Upsert đề ${code}: ${exam.questions?.length ?? 0} câu (id=${doc._id})`,
    );
    return doc;
  }

  /** Tìm đề theo examCode (uppercase). null nếu không có. */
  async findByExamCode(code: string): Promise<ExamDocument | null> {
    return this.examModel.findOne({ examCode: code.trim().toUpperCase() });
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
