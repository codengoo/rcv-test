import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ExamAnswerEdit,
  ExamService,
} from './exam.service';
import { ExamDocument } from './exam.schema';

/** Đề trả cho web (xem/sửa). Gồm đáp án + giải thích từng câu. */
interface ExamDetail {
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

@Controller('api')
export class ExamController {
  constructor(private readonly exams: ExamService) {}

  /** Xem đề công khai theo examCode (link ?exam_code=A02). */
  @Get('exam/:examCode')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async view(@Param('examCode') examCode: string): Promise<ExamDetail> {
    const doc = await this.exams.findByExamCode(examCode);
    if (!doc) throw new NotFoundException('Không tìm thấy đề.');
    return this.toDetail(doc);
  }

  /** Lấy đề để sửa theo editCode 6 số (link ?exam_edit=NNNNNN). */
  @Get('exam-edit/:code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async forEdit(@Param('code') code: string): Promise<ExamDetail> {
    const doc = await this.exams.findByEditCode(code);
    if (!doc) throw new NotFoundException('Không tìm thấy đề.');
    return this.toDetail(doc);
  }

  /** Lưu sửa đáp án + giải thích (không đổi câu hỏi, không chấm lại bài cũ). */
  @Patch('exam-edit/:code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async save(
    @Param('code') code: string,
    @Body() body: { questions?: ExamAnswerEdit[] },
  ): Promise<ExamDetail> {
    const edits = Array.isArray(body?.questions) ? body.questions : [];
    const doc = await this.exams.updateAnswers(code, edits);
    if (!doc) throw new NotFoundException('Không tìm thấy đề.');
    return this.toDetail(doc);
  }

  private toDetail(d: ExamDocument): ExamDetail {
    return {
      examCode: d.examCode,
      title: d.title ?? '',
      questions: (d.questions ?? []).map((q) => ({
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
