# Phase 01 — Schema & SubmissionService (nền data-model)

**Goal:** Submission lưu được điểm thành phần từng câu (`earnedPoints`), tổng điểm thực (`totalScore`), trạng thái (`status`), `reviewCode` 6 số duy nhất, và vị trí dòng Sheet (`sheetRange`). SubmissionService biết sinh reviewCode, tìm theo reviewCode, áp dụng review (tính lại điểm + đổi trạng thái), set sheetRange, và format điểm.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/submission/submission.schema.ts | MODIFY |
| src/submission/submission.service.ts | MODIFY |

## 2. submission.schema.ts
SubmissionQuestion thêm 2 prop (sau `isCorrect`):
```ts
@Prop({ type: String, default: '' }) type!: string;
@Prop({ type: Number, default: 0 }) earnedPoints!: number;
```
Submission thêm (sau `note` hoặc gom cùng nhóm grading):
```ts
@Prop({ type: String, default: 'auto_graded', index: true }) status!: string;
@Prop({ type: String, required: true, unique: true, index: true }) reviewCode!: string;
@Prop({ type: Number, default: 0 }) totalScore!: number;
@Prop({ type: Number, default: 0 }) maxScore!: number;
@Prop({ type: String, default: '' }) sheetRange!: string;
@Prop({ type: Date }) reviewedAt?: Date;
```

## 3. submission.service.ts
### 3a. Hằng số trạng thái + helper điểm (export để controller dùng)
```ts
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

/** Format điểm hiển thị: bỏ .00 thừa. 4 -> "4", 3.5 -> "3.5", 3.75 -> "3.75". */
export function formatScore(n: number): string {
  return Number(roundScore(n).toFixed(2)).toString();
}
```
### 3b. SubmissionInput
Thêm `type`, `earnedPoints` vào mỗi phần tử `questions`; thêm `totalScore`, `maxScore` ở cấp input (Discord truyền vào — xem phase 03). `questions[]`:
```ts
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
// + totalScore: number; maxScore: number;
```
### 3c. create() — sinh reviewCode duy nhất
```ts
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
          `(mã đề ${input.examCode}, reviewCode ${reviewCode})`,
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
```
Helper (module scope):
```ts
/** Code 6 số ngẫu nhiên "000000".."999999". */
function randomReviewCode(): string {
  return Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
}
```
### 3d. findByReviewCode
```ts
async findByReviewCode(code: string): Promise<SubmissionDocument | null> {
  if (!/^\d{6}$/.test(code)) return null;
  return this.model.findOne({ reviewCode: code });
}
```
### 3e. setSheetRange (Discord gọi sau khi append Sheet)
```ts
async setSheetRange(id: string, range: string): Promise<void> {
  await this.model.updateOne({ _id: id }, { $set: { sheetRange: range } });
}
```
### 3f. applyReview — cốt lõi tính lại điểm + đổi trạng thái
```ts
export interface ReviewEdit {
  id: string;
  isCorrect: boolean;
  earnedPoints: number;
}

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
```

## 4. Encapsulation / wiring notes
- Mọi truy cập Model nằm trong SubmissionService (đúng pattern hiện có — comment ở đầu file).
- Controller (phase 04) chỉ gọi `findByReviewCode` / `applyReview`, KHÔNG import Model.
- `randomReviewCode` để module-scope (không export) — chỉ create() dùng.
- Không đụng `buildAccessCode` (giữ nguyên cơ chế mật khẩu phụ huynh).

## 5. Acceptance criteria
- [ ] `npx tsc --noEmit -p tsconfig.json` pass.
- [ ] App boot không lỗi schema (`npm run start:dev` lên được, hoặc build pass).
- [ ] Đọc lại: SubmissionQuestion có `type`,`earnedPoints`; Submission có `status`,`reviewCode`(unique),`totalScore`,`maxScore`,`sheetRange`,`reviewedAt`.
- [ ] SubmissionService export `applyReview`, `findByReviewCode`, `setSheetRange`, `SUBMISSION_STATUS`, `formatScore`, `clampPoints`, `roundScore`, `ReviewEdit`.

## 6. Out of scope (phase này)
- Không gọi từ Discord/Controller (phase 03/04).
- Không động web.

## 7. Commit message dự kiến
```
feat(submission): điểm thành phần, trạng thái review & reviewCode

Thêm earnedPoints/type cho từng câu; totalScore/maxScore/status/reviewCode
(unique)/sheetRange cho submission. SubmissionService sinh reviewCode duy nhất
khi create, thêm findByReviewCode/applyReview (tính lại điểm + set confirmed)/
setSheetRange và helper format điểm. Mọi truy cập Model giữ trong service.
```
