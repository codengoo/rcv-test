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
  @Prop({ type: [SubmissionQuestionSchema], default: [] })
  questions!: SubmissionQuestion[];
  @Prop({ type: [SubmissionImageSchema], default: [] })
  images!: SubmissionImage[];
  @Prop({ type: String, default: '' }) note!: string;
}
export const SubmissionSchema = SchemaFactory.createForClass(Submission);
