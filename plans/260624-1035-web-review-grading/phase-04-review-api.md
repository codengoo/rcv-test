# Phase 04 — Review API: GET/PATCH /api/review/:code + update Sheet ô điểm

**Goal:** Có endpoint cho giám thị (qua code 6 số) lấy chi tiết sửa được và lưu thay đổi: cập nhật điểm từng câu → tính lại tổng → status=confirmed → cập nhật ô Điểm trong Sheet. Hiển thị status/điểm cũng được bổ sung vào ResultDetail công khai.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/results/review.controller.ts | CREATE |
| src/results/results.module.ts | MODIFY |
| src/results/results.controller.ts | MODIFY (toDetail thêm status/totalScore/scoreText, questions thêm type/earnedPoints) |

## 2. review.controller.ts (MỚI)
```ts
@Controller('api/review')
export class ReviewController {
  private readonly logger = new Logger(ReviewController.name);
  private readonly sheetId: string;
  private sheetTitleCache = '';

  constructor(
    private readonly submissions: SubmissionService,
    private readonly sheets: GoogleSheetsService,
    private readonly config: ConfigService,
  ) {
    this.sheetId = this.config.get<string>('GOOGLE_SHEET_ID') ?? '';
  }

  /** Lấy chi tiết để sửa (code 6 số trong URL là bí mật). */
  @Get(':code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async detail(@Param('code') code: string): Promise<ReviewDetail> {
    const doc = await this.submissions.findByReviewCode(code);
    if (!doc) throw new NotFoundException('Không tìm thấy bài thi.');
    return this.toReviewDetail(doc);
  }

  /** Lưu chỉnh sửa của giám thị → tính lại điểm + cập nhật Sheet. */
  @Patch(':code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async save(
    @Param('code') code: string,
    @Body() body: { questions?: ReviewEdit[] },
  ): Promise<ReviewDetail> {
    const edits = Array.isArray(body?.questions) ? body.questions : [];
    const doc = await this.submissions.applyReview(code, edits);
    if (!doc) throw new NotFoundException('Không tìm thấy bài thi.');
    await this.syncSheetScore(doc); // best-effort
    return this.toReviewDetail(doc);
  }

  /** Cập nhật ô Điểm (cột E) trong Sheet dựa trên sheetRange đã lưu. */
  private async syncSheetScore(doc: SubmissionDocument): Promise<void> {
    if (!this.sheetId || !doc.sheetRange) return;
    const cell = scoreCellFromRange(doc.sheetRange); // "Kết quả!A5:G5" -> "Kết quả!E5"
    if (!cell) return;
    try {
      await this.sheets.updateCell(this.sheetId, cell, `${formatScore(doc.totalScore)} điểm`);
      this.logger.log(`Cập nhật Sheet ${cell} = ${doc.totalScore}đ (reviewCode ${doc.reviewCode})`);
    } catch (err) {
      this.logger.warn(`Cập nhật Sheet thất bại (review vẫn OK): ${(err as Error).message}`);
    }
  }

  private toReviewDetail(d: SubmissionDocument): ReviewDetail { /* map như §5 plan.md */ }
}
```
Helper (module-scope) định vị ô Điểm từ range append:
```ts
/** "Kết quả!A5:G5" -> "Kết quả!E5" (cột E = Điểm). null nếu không parse được. */
function scoreCellFromRange(range: string): string | null {
  const m = range.match(/^(.*!)?[A-Z]+(\d+):[A-Z]+\d+$/);
  if (!m) return null;
  const sheetPrefix = m[1] ?? '';
  const rowNum = range.match(/[A-Z]+(\d+):/)?.[1];
  if (!rowNum) return null;
  return `${sheetPrefix}E${rowNum}`;
}
```
`ReviewDetail`/`ReviewEdit`: theo §5 plan.md. `scoreText = formatScore(d.totalScore)`.
Hình ảnh dùng lại `driveImageUrl` (export từ results.controller.ts hoặc copy helper nhỏ).

## 3. results.module.ts
```ts
import { GoogleSheetsModule } from '../shared/google-sheets/google-sheets.module'; // nếu có; else providers
@Module({
  imports: [SubmissionModule /*, module chứa GoogleSheetsService */],
  controllers: [ResultsController, ReviewController],
})
```
> Kiểm tra GoogleSheetsService được export từ module nào (shared). Import module đó
> vào ResultsModule để inject vào ReviewController. ConfigModule đã global.

## 4. results.controller.ts (hiển thị thêm)
`ResultDetail` thêm: `status: string`, `totalScore: number`, `scoreText: string`; mỗi question thêm `type`, `earnedPoints`. `toDetail` map các field mới (fallback `totalScore` = `correctCount` nếu 0 và có correctCount, để bản ghi cũ vẫn hiển thị).

## 5. Encapsulation / wiring notes
- ReviewController KHÔNG import Model — chỉ dùng SubmissionService.
- Kiến thức "cột E = Điểm" nằm ở review.controller (đồng bộ với thứ tự cột phase 03). Ghi chú rõ trong comment để hai nơi không lệch.
- updateCell best-effort: lỗi Sheet không làm fail PATCH (giám thị vẫn lưu được).
- Throttle cả GET (đoán code) lẫn PATCH.

## 6. Acceptance criteria
- [ ] `npx tsc --noEmit` pass; app boot, route `/api/review/:code` đăng ký.
- [ ] (Manual) GET `/api/review/<reviewCode thật>` → JSON ReviewDetail; sai code → 404.
- [ ] (Manual) PATCH với body questions → totalScore tính lại đúng (clamp [0,1]), status=confirmed; ô Điểm Sheet đổi (nếu có sheetRange).
- [ ] `GET /api/results/:id/unlock` (cũ) vẫn trả detail + có status/scoreText (regression).

## 7. Out of scope
- Giao diện sửa (phase 05).

## 6. Commit message dự kiến
```
feat(results): review API cho giám thị + sync điểm vào Sheet

Thêm ReviewController GET/PATCH /api/review/:code (code 6 số trong URL):
lấy chi tiết sửa được, lưu thay đổi qua SubmissionService.applyReview rồi cập
nhật ô Điểm (cột E) trong Sheet theo sheetRange đã lưu. ResultDetail công khai
bổ sung status/totalScore/scoreText + type/earnedPoints mỗi câu. Throttle GET/PATCH.
```
