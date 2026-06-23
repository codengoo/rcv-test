# Phase 01 — Nền MongoDB (mongoose + env + schema)

**Goal:** App kết nối được MongoDB qua `@nestjs/mongoose`. Có env `MONGODB_URI` (validated), `MongooseModule.forRootAsync` trong app.module, và 2 schema `Exam` + `Submission` định nghĩa sẵn (chưa cần service/CRUD — phase sau dùng).

## 1. Files chạm vào
| File | Action |
|---|---|
| package.json | MODIFY (deps: @nestjs/mongoose, mongoose) |
| src/config/env.validation.ts | MODIFY (thêm MONGODB_URI, PORT optional) |
| .env.example | MODIFY |
| src/app.module.ts | MODIFY (MongooseModule.forRootAsync) |
| src/exam/exam.schema.ts | CREATE |
| src/submission/submission.schema.ts | CREATE |

## 2. package.json
Thêm `dependencies`:
```json
"@nestjs/mongoose": "^11.0.0",
"mongoose": "^8.9.0"
```

## 3. src/config/env.validation.ts
Thêm vào class `EnvironmentVariables`:
```ts
  // Chuỗi kết nối MongoDB (local hoặc Atlas). Nguồn dữ liệu chính cho đề + kết quả.
  @IsString()
  MONGODB_URI!: string;

  // Cổng HTTP server (REST API + React build). Mặc định 3000.
  @IsOptional()
  @IsString()
  PORT?: string;
```

## 4. .env.example
Thêm:
```
# MongoDB — nguồn dữ liệu chính (đề thi + kết quả chấm)
MONGODB_URI=mongodb://localhost:27017/rcv
# Cổng HTTP cho web tra cứu kết quả
PORT=3000
```

## 5. src/exam/exam.schema.ts
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class ExamQuestion {
  @Prop({ required: true }) id!: string;
  @Prop({ required: true }) type!: string;
  @Prop({ default: '' }) question!: string;
  @Prop({ type: [String], default: [] }) options!: string[];
  @Prop({ default: '' }) correctAnswer!: string;
  @Prop({ default: '' }) explanation!: string;
}
const ExamQuestionSchema = SchemaFactory.createForClass(ExamQuestion);

export type ExamDocument = HydratedDocument<Exam>;

@Schema({ timestamps: true, collection: 'exams' })
export class Exam {
  @Prop({ required: true, unique: true, uppercase: true, index: true })
  examCode!: string;

  @Prop({ default: '' }) title!: string;

  @Prop({ type: [ExamQuestionSchema], default: [] })
  questions!: ExamQuestion[];
}
export const ExamSchema = SchemaFactory.createForClass(Exam);
```

## 6. src/submission/submission.schema.ts
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class SubmissionQuestion {
  @Prop({ required: true }) id!: string;
  @Prop({ default: '' }) studentAnswer!: string;
  @Prop({ default: '' }) correctAnswer!: string;
  @Prop({ default: false }) isCorrect!: boolean;
  @Prop({ default: '' }) question!: string;
  @Prop({ type: [String], default: [] }) options!: string[];
  @Prop({ default: '' }) explanation!: string;
}
const SubmissionQuestionSchema = SchemaFactory.createForClass(SubmissionQuestion);

@Schema({ _id: false })
export class SubmissionImage {
  @Prop({ required: true }) fileId!: string;
  @Prop({ default: '' }) link!: string;
}
const SubmissionImageSchema = SchemaFactory.createForClass(SubmissionImage);

export type SubmissionDocument = HydratedDocument<Submission>;

@Schema({ timestamps: true, collection: 'submissions' })
export class Submission {
  @Prop({ required: true, index: true }) examCode!: string;
  @Prop({ default: '' }) fullName!: string;
  @Prop({ default: '' }) parentName!: string;
  @Prop({ default: '' }) parentPhone!: string; // KHÔNG expose ở list
  @Prop({ default: '' }) className!: string;
  @Prop({ default: '' }) dob!: string;          // ddMM hoặc ""
  @Prop({ required: true }) accessCode!: string; // ddMM+last2phone | "000000"
  @Prop({ default: '' }) score!: string;
  @Prop({ default: 0 }) correctCount!: number;
  @Prop({ default: 0 }) totalQuestions!: number;
  @Prop({ type: [SubmissionQuestionSchema], default: [] })
  questions!: SubmissionQuestion[];
  @Prop({ type: [SubmissionImageSchema], default: [] })
  images!: SubmissionImage[];
  @Prop({ default: '' }) note!: string;
}
export const SubmissionSchema = SchemaFactory.createForClass(Submission);
```

## 7. src/app.module.ts
Thêm `MongooseModule.forRootAsync`:
```ts
import { MongooseModule } from '@nestjs/mongoose';
// trong imports[]:
MongooseModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    uri: config.getOrThrow<string>('MONGODB_URI'),
  }),
}),
```
(import `ConfigService` từ `@nestjs/config`.)

## 8. Encapsulation / wiring notes
- Phase này CHỈ định nghĩa schema + kết nối. CHƯA tạo ExamModule/SubmissionModule với `MongooseModule.forFeature` (làm ở phase 02/03 nơi cần repository).
- Không đụng quiz/grade/discord ở phase này.

## 9. Acceptance criteria
- [ ] `npm i` cài @nestjs/mongoose + mongoose OK.
- [ ] `npm run typecheck` pass.
- [ ] `npm run build` pass.
- [ ] Với `MONGODB_URI` trỏ Mongo đang chạy: `npm run start` boot, log "MongooseModule dependencies initialized" / không lỗi kết nối.
- [ ] Đặt `MONGODB_URI` sai → app fail-fast với log lỗi kết nối rõ ràng (không crash âm thầm).

## 10. Out of scope (phase này)
- Service/repository, seed, controller, FE (phase 02–05).

## 11. Commit message dự kiến
```
feat(mongo): add MongoDB foundation (mongoose + Exam/Submission schemas)

Wire @nestjs/mongoose via MongooseModule.forRootAsync (MONGODB_URI env,
validated) and define Exam + Submission schemas as the new primary data
store for exams and grading results. No CRUD/seed yet. Adds PORT env for
the upcoming HTTP server.
```
