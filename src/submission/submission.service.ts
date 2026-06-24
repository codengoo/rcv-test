import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Submission, SubmissionDocument } from './submission.schema';

/** Dữ liệu tạo 1 submission (từ DiscordService sau khi chấm). */
export interface SubmissionInput {
  examCode: string;
  fullName: string;
  parentName: string;
  parentPhone: string;
  className: string;
  dob: string;
  score: string;
  correctCount: number;
  totalQuestions: number;
  totalScore: number;
  maxScore: number;
  questions: {
    id: string;
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    type: string;
    earnedPoints: number;
    question: string;
    options: string[];
    explanation: string;
  }[];
  images: { fileId: string; link: string }[];
  note: string;
}

/** Một chỉnh sửa của giám thị cho 1 câu (từ ReviewController). */
export interface ReviewEdit {
  id: string;
  isCorrect: boolean;
  earnedPoints: number;
}

/** Trạng thái review của submission. */
export const SUBMISSION_STATUS = {
  AUTO_GRADED: 'auto_graded',
  CONFIRMED: 'confirmed',
} as const;

/** Giới hạn điểm 1 câu về [0,1] (mỗi câu tối đa 1 điểm). */
export function clampPoints(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Tổng điểm làm tròn 2 chữ số thập phân (số). */
export function roundScore(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format điểm hiển thị, bỏ .00 thừa: 4 -> "4", 3.5 -> "3.5", 3.75 -> "3.75". */
export function formatScore(n: number): string {
  return Number(roundScore(n).toFixed(2)).toString();
}

/** Code 6 số ngẫu nhiên "000000".."999999" cho link sửa của giám thị. */
function randomReviewCode(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
}

/**
 * Tính accessCode = 6 số cuối của số điện thoại phụ huynh. Nếu SĐT có ít hơn
 * 6 chữ số → mặc định "000000".
 */
export function buildAccessCode(parentPhone: string): string {
  const digits = (parentPhone || '').replace(/\D/g, '');
  if (digits.length < 6) return '000000';
  return digits.slice(-6);
}

/**
 * Nguồn dữ liệu kết quả chấm trên MongoDB. DiscordService ghi qua đây;
 * ResultsController (phase 04) đọc qua đây. Mọi truy cập Model nằm trong service.
 */
@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    @InjectModel(Submission.name)
    private readonly model: Model<SubmissionDocument>,
  ) {}

  /**
   * Lưu 1 submission; accessCode = 6 số cuối SĐT phụ huynh; reviewCode = 6 số
   * ngẫu nhiên duy nhất (retry nếu trùng unique index); status = auto_graded.
   */
  async create(input: SubmissionInput): Promise<SubmissionDocument> {
    const accessCode = buildAccessCode(input.parentPhone);
    for (let attempt = 1; attempt <= 6; attempt++) {
      const reviewCode = randomReviewCode();
      try {
        const doc = await this.model.create({
          ...input,
          accessCode,
          reviewCode,
          status: SUBMISSION_STATUS.AUTO_GRADED,
        });
        this.logger.log(
          `Lưu submission ${doc._id}: "${input.fullName}" ${input.totalScore}đ ` +
            `(mã đề ${input.examCode}, accessCode ${accessCode}, reviewCode ${reviewCode})`,
        );
        return doc;
      } catch (err) {
        // Trùng reviewCode (unique index) → thử code khác.
        if ((err as { code?: number }).code === 11000 && attempt < 6) continue;
        throw err;
      }
    }
    throw new Error('Không sinh được reviewCode duy nhất sau 6 lần');
  }

  /** Danh sách kết quả (mới nhất trước) cho API công khai. */
  async list(): Promise<SubmissionDocument[]> {
    return this.model.find().sort({ createdAt: -1 });
  }

  /** Tìm 1 submission theo id (cho unlock). null nếu không tồn tại/id sai. */
  async findById(id: string): Promise<SubmissionDocument | null> {
    if (!id.match(/^[a-fA-F0-9]{24}$/)) return null;
    return this.model.findById(id);
  }

  /** Tìm 1 submission theo reviewCode 6 số (cho link sửa của giám thị). */
  async findByReviewCode(code: string): Promise<SubmissionDocument | null> {
    if (!/^\d{6}$/.test(code)) return null;
    return this.model.findOne({ reviewCode: code });
  }

  /** Lưu lại vị trí dòng trong Sheet (sau khi DiscordService append xong). */
  async setSheetRange(id: string, range: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { sheetRange: range } });
  }

  /**
   * Áp dụng chỉnh sửa của giám thị: cập nhật isCorrect/earnedPoints từng câu,
   * tính lại totalScore + correctCount, chuyển status = confirmed. Trả null nếu
   * không tìm thấy reviewCode.
   */
  async applyReview(
    code: string,
    edits: ReviewEdit[],
  ): Promise<SubmissionDocument | null> {
    const doc = await this.findByReviewCode(code);
    if (!doc) return null;
    const byId = new Map(edits.map((e) => [e.id, e]));
    let total = 0;
    let correct = 0;
    for (const q of doc.questions) {
      const e = byId.get(q.id);
      if (e) {
        q.isCorrect = e.isCorrect;
        q.earnedPoints = clampPoints(e.earnedPoints);
      }
      total += q.earnedPoints;
      if (q.isCorrect) correct += 1;
    }
    doc.totalScore = roundScore(total);
    doc.correctCount = correct;
    doc.score = `${correct}/${doc.totalQuestions}`;
    doc.status = SUBMISSION_STATUS.CONFIRMED;
    doc.reviewedAt = new Date();
    await doc.save();
    this.logger.log(
      `Review submission ${doc._id} (reviewCode ${code}): ${doc.totalScore}đ, status=confirmed`,
    );
    return doc;
  }
}
