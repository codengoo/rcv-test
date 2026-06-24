import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  ReviewEdit,
  SubmissionService,
  formatScore,
  statusText,
} from '../submission/submission.service';
import { SubmissionDocument } from '../submission/submission.schema';
import { GoogleSheetsService } from '../shared/google-sheets/google-sheets.service';

/** Chi tiết bài thi cho giám thị sửa (truy cập bằng reviewCode 6 số trong URL). */
interface ReviewDetail {
  id: string;
  status: string;
  fullName: string;
  className: string;
  examCode: string;
  totalScore: number;
  maxScore: number;
  scoreText: string;
  note: string;
  images: { url: string }[];
  questions: {
    id: string;
    type: string;
    question: string;
    options: string[];
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    earnedPoints: number;
    explanation: string;
  }[];
}

/** Dựng URL ảnh ổn định cho <img> từ Drive fileId. */
function driveImageUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`;
}

/**
 * Định vị 1 ô theo cột từ range append, vd cellFromRange("Kết quả!A5:G5", "E")
 * -> "Kết quả!E5". null nếu range không parse được. Thứ tự cột khớp DiscordService
 * (A Họ tên · B Bố/mẹ · C SĐT · D Lớp · E Điểm · F Trạng thái · G Link KQ).
 */
function cellFromRange(range: string, col: string): string | null {
  // Tách prefix tên sheet (phần trước "!") nếu có.
  const bang = range.lastIndexOf('!');
  const prefix = bang >= 0 ? range.slice(0, bang + 1) : '';
  const a1 = bang >= 0 ? range.slice(bang + 1) : range;
  const m = a1.match(/^[A-Z]+(\d+):[A-Z]+\d+$/);
  if (!m) return null;
  return `${prefix}${col}${m[1]}`;
}

@Controller('api/review')
export class ReviewController {
  private readonly logger = new Logger(ReviewController.name);
  private readonly sheetId: string;

  constructor(
    private readonly submissions: SubmissionService,
    private readonly sheets: GoogleSheetsService,
    private readonly config: ConfigService,
  ) {
    this.sheetId = this.config.get<string>('GOOGLE_SHEET_ID') ?? '';
  }

  /** Lấy chi tiết để sửa. reviewCode 6 số trong URL chính là quyền truy cập. */
  @Get(':code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async detail(@Param('code') code: string): Promise<ReviewDetail> {
    const doc = await this.submissions.findByReviewCode(code);
    if (!doc) throw new NotFoundException('Không tìm thấy bài thi.');
    return this.toReviewDetail(doc);
  }

  /** Lưu chỉnh sửa của giám thị → tính lại điểm + cập nhật ô Điểm trong Sheet. */
  @Patch(':code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async save(
    @Param('code') code: string,
    @Body() body: { questions?: ReviewEdit[] },
  ): Promise<ReviewDetail> {
    const edits = Array.isArray(body?.questions) ? body.questions : [];
    const doc = await this.submissions.applyReview(code, edits);
    if (!doc) throw new NotFoundException('Không tìm thấy bài thi.');
    await this.syncSheetScore(doc); // best-effort, không chặn phản hồi
    return this.toReviewDetail(doc);
  }

  /** Cập nhật ô Điểm (E) + Trạng thái (F) trong Sheet theo sheetRange đã lưu. */
  private async syncSheetScore(doc: SubmissionDocument): Promise<void> {
    if (!this.sheetId || !doc.sheetRange) return;
    const scoreCell = cellFromRange(doc.sheetRange, 'E');
    const statusCell = cellFromRange(doc.sheetRange, 'F');
    try {
      if (scoreCell) {
        await this.sheets.updateCell(
          this.sheetId,
          scoreCell,
          formatScore(doc.totalScore),
        );
      }
      if (statusCell) {
        await this.sheets.updateCell(
          this.sheetId,
          statusCell,
          statusText(doc.status),
        );
      }
      this.logger.log(
        `Cập nhật Sheet ${scoreCell ?? '?'}=${doc.totalScore}đ, ${statusCell ?? '?'}=${doc.status} (reviewCode ${doc.reviewCode})`,
      );
    } catch (err) {
      this.logger.warn(
        `Cập nhật Sheet thất bại (review vẫn OK): ${(err as Error).message}`,
      );
    }
  }

  private toReviewDetail(d: SubmissionDocument): ReviewDetail {
    return {
      id: d._id.toString(),
      status: d.status,
      fullName: d.fullName,
      className: d.className,
      examCode: d.examCode,
      totalScore: d.totalScore,
      maxScore: d.maxScore || d.totalQuestions,
      scoreText: formatScore(d.totalScore),
      note: d.note,
      images: d.images.map((img) => ({ url: driveImageUrl(img.fileId) })),
      questions: d.questions.map((q) => ({
        id: q.id,
        type: q.type,
        question: q.question,
        options: q.options,
        studentAnswer: q.studentAnswer,
        correctAnswer: q.correctAnswer,
        isCorrect: q.isCorrect,
        earnedPoints: q.earnedPoints,
        explanation: q.explanation,
      })),
    };
  }
}
