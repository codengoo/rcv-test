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
  questions: {
    id: string;
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    question: string;
    options: string[];
    explanation: string;
  }[];
  images: { fileId: string; link: string }[];
  note: string;
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

  /** Lưu 1 submission; accessCode = 6 số cuối SĐT phụ huynh. */
  async create(input: SubmissionInput): Promise<SubmissionDocument> {
    const accessCode = buildAccessCode(input.parentPhone);
    const doc = await this.model.create({ ...input, accessCode });
    this.logger.log(
      `Lưu submission ${doc._id}: "${input.fullName}" ${input.score} ` +
        `(mã đề ${input.examCode}, accessCode ${accessCode})`,
    );
    return doc;
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
}
