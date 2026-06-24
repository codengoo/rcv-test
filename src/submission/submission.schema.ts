import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Mọi @Prop khai báo `type` tường minh (không dựa vào reflect-metadata) để
// schema nạp được cả bằng tsx/esbuild lẫn tsc.

@Schema({ _id: false })
export class SubmissionQuestion {
  @Prop({ type: String, required: true }) id!: string;
  @Prop({ type: String, default: '' }) studentAnswer!: string;
  @Prop({ type: String, default: '' }) correctAnswer!: string;
  @Prop({ type: Boolean, default: false }) isCorrect!: boolean;
  @Prop({ type: String, default: '' }) type!: string; // loại câu (carry từ Exam)
  @Prop({ type: Number, default: 0 }) earnedPoints!: number; // điểm câu này, 0..1
  @Prop({ type: String, default: '' }) question!: string;
  @Prop({ type: [String], default: [] }) options!: string[];
  @Prop({ type: String, default: '' }) explanation!: string;
}
const SubmissionQuestionSchema = SchemaFactory.createForClass(SubmissionQuestion);

@Schema({ _id: false })
export class SubmissionImage {
  @Prop({ type: String, required: true }) fileId!: string;
  @Prop({ type: String, default: '' }) link!: string;
}
const SubmissionImageSchema = SchemaFactory.createForClass(SubmissionImage);

export type SubmissionDocument = HydratedDocument<Submission>;

@Schema({ timestamps: true, collection: 'submissions' })
export class Submission {
  @Prop({ type: String, required: true, index: true }) examCode!: string;
  @Prop({ type: String, default: '' }) fullName!: string;
  @Prop({ type: String, default: '' }) parentName!: string;
  @Prop({ type: String, default: '' }) parentPhone!: string; // KHÔNG expose ở list
  @Prop({ type: String, default: '' }) className!: string;
  @Prop({ type: String, default: '' }) dob!: string; // ddMM hoặc ""
  @Prop({ type: String, required: true }) accessCode!: string; // ddMM+last2phone | "000000"
  @Prop({ type: String, default: '' }) score!: string;
  @Prop({ type: Number, default: 0 }) correctCount!: number;
  @Prop({ type: Number, default: 0 }) totalQuestions!: number;
  // Trạng thái review: auto_graded (chấm tự động) | confirmed (giám thị xác nhận).
  @Prop({ type: String, default: 'auto_graded', index: true }) status!: string;
  // Code 6 số cho link sửa của giám thị (duy nhất).
  @Prop({ type: String, required: true, unique: true, index: true })
  reviewCode!: string;
  @Prop({ type: Number, default: 0 }) totalScore!: number; // tổng điểm thực (sum earnedPoints)
  @Prop({ type: Number, default: 0 }) maxScore!: number; // = totalQuestions (mỗi câu 1đ)
  @Prop({ type: String, default: '' }) sheetRange!: string; // vd "Kết quả!A5:G5" (để update lại điểm)
  @Prop({ type: Date }) reviewedAt?: Date;
  @Prop({ type: [SubmissionQuestionSchema], default: [] })
  questions!: SubmissionQuestion[];
  @Prop({ type: [SubmissionImageSchema], default: [] })
  images!: SubmissionImage[];
  @Prop({ type: String, default: '' }) note!: string;
}
export const SubmissionSchema = SchemaFactory.createForClass(Submission);
