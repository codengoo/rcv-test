import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Lưu ý: mọi @Prop khai báo `type` tường minh (không dựa vào reflect-metadata)
// để schema chạy được cả khi nạp bằng tsx/esbuild (seed) lẫn tsc (nest build).

@Schema({ _id: false })
export class ExamQuestion {
  @Prop({ type: String, required: true }) id!: string;
  @Prop({ type: String, required: true }) type!: string;
  @Prop({ type: String, default: '' }) question!: string;
  @Prop({ type: [String], default: [] }) options!: string[];
  @Prop({ type: String, default: '' }) correctAnswer!: string;
  @Prop({ type: String, default: '' }) explanation!: string;
}
const ExamQuestionSchema = SchemaFactory.createForClass(ExamQuestion);

export type ExamDocument = HydratedDocument<Exam>;

@Schema({ timestamps: true, collection: 'exams' })
export class Exam {
  @Prop({ type: String, required: true, unique: true, uppercase: true, index: true })
  examCode!: string;

  @Prop({ type: String, default: '' }) title!: string;

  @Prop({ type: [ExamQuestionSchema], default: [] })
  questions!: ExamQuestion[];
}
export const ExamSchema = SchemaFactory.createForClass(Exam);
