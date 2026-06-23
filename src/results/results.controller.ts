import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubmissionService } from '../submission/submission.service';
import { SubmissionDocument } from '../submission/submission.schema';

/** Mục công khai trong danh sách kết quả (KHÔNG kèm phone/ảnh/đáp án). */
interface ResultListItem {
  id: string;
  fullName: string;
  className: string;
  score: string;
  examCode: string;
  createdAt: string;
}

/** Chi tiết kết quả (trả sau khi unlock đúng accessCode). */
interface ResultDetail {
  id: string;
  fullName: string;
  className: string;
  examCode: string;
  score: string;
  correctCount: number;
  totalQuestions: number;
  note: string;
  images: { url: string }[];
  questions: {
    id: string;
    question: string;
    options: string[];
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    explanation: string;
  }[];
}

/** Dựng URL ảnh ổn định cho <img> từ Drive fileId (fallback uc?export=view). */
function driveImageUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`;
}

@Controller('api/results')
export class ResultsController {
  constructor(private readonly submissions: SubmissionService) {}

  /** Danh sách công khai: chỉ field tối thiểu. */
  @Get()
  async list(): Promise<{ items: ResultListItem[] }> {
    const docs = await this.submissions.list();
    const items = docs.map((d) => this.toListItem(d));
    return { items };
  }

  /**
   * Mở khóa chi tiết bằng accessCode (check server-side, rate-limited).
   * Sai code → 401. Đúng → trả ResultDetail đầy đủ.
   */
  @Post(':id/unlock')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async unlock(
    @Param('id') id: string,
    @Body('code') code: string,
  ): Promise<ResultDetail> {
    const doc = await this.submissions.findById(id);
    if (!doc || (code ?? '').trim() !== doc.accessCode) {
      throw new UnauthorizedException('Mật khẩu không đúng.');
    }
    return this.toDetail(doc);
  }

  private toListItem(d: SubmissionDocument): ResultListItem {
    return {
      id: d._id.toString(),
      fullName: d.fullName,
      className: d.className,
      score: d.score,
      examCode: d.examCode,
      createdAt: (d as { createdAt?: Date }).createdAt?.toISOString() ?? '',
    };
  }

  private toDetail(d: SubmissionDocument): ResultDetail {
    return {
      id: d._id.toString(),
      fullName: d.fullName,
      className: d.className,
      examCode: d.examCode,
      score: d.score,
      correctCount: d.correctCount,
      totalQuestions: d.totalQuestions,
      note: d.note,
      images: d.images.map((img) => ({ url: driveImageUrl(img.fileId) })),
      questions: d.questions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        studentAnswer: q.studentAnswer,
        correctAnswer: q.correctAnswer,
        isCorrect: q.isCorrect,
        explanation: q.explanation,
      })),
    };
  }
}
