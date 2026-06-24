# Web review / chấm lại bài thi cho cán bộ chấm thi

**Date:** 2026-06-24 10:35 (+07)
**Scope:** src/submission, src/grade, src/results, src/discord, src/shared/google-sheets, web/src
**Trigger:** Bài thi hiện chỉ được Gemini chấm tự động (đúng/sai mỗi câu) rồi chốt điểm. Cần cho cán bộ chấm thi (giám thị) vào web sửa kết quả từng câu — kể cả cho điểm lẻ ở câu tự luận — để ra điểm cuối cùng, và đánh dấu bài đã được người xác nhận. Discord report kèm link sửa có code 6 số; Sheet cập nhật lại điểm khi giám thị xác nhận.

## 1. Goal
Khi xong:
- Mỗi submission có **trạng thái**: `auto_graded` (Đã chấm tự động) → `confirmed` (Đã xác nhận bởi cán bộ chấm thi).
- Mỗi submission có **reviewCode** 6 số duy nhất; Discord report kèm 2 link: xem kết quả (như cũ) + **link sửa** `?review_code=NNNNNN`.
- Trang web có chế độ **sửa**: giám thị toggle đúng/sai từng câu và nhập điểm lẻ (0–1) cho câu tự luận; tổng điểm tính lại realtime; bấm lưu → status = confirmed.
- Mỗi câu có **điểm thành phần** (`earnedPoints` 0–1, mỗi câu tối đa 1 điểm). **Tổng điểm** (`totalScore`) là số thực, hiển thị 2 chữ số thập phân (vd `3.75 điểm`).
- Google Sheet: cột A–G = Họ tên HS, Tên bố/mẹ, SĐT, Lớp, Điểm bài làm, Link ảnh bài làm, **Link xem kết quả (web)**. Khi giám thị xác nhận, ô **Điểm** trong Sheet được cập nhật lại.
- ResultDetailView hiển thị note: "Bài thi được chấm tự động bởi `RCV exam` và được chấm lại bởi cán bộ chấm thi."

## 2. Quyết định đã chốt (từ Q&A 2 vòng)
| Câu hỏi | Lựa chọn |
|---|---|
| Điểm bài làm trong Sheet | Số điểm thực tế, điểm lẻ (vd `3.75`) — KHÔNG dùng "X/Y" |
| Thang điểm mỗi câu | Mỗi câu tối đa **1 điểm**. Trắc nghiệm: 0 hoặc 1. Tự luận: điểm lẻ 0–1 |
| Thao tác giám thị mỗi câu | **Toggle đúng/sai + ô điểm lẻ** (toggle set 0/1; ô điểm lẻ override) |
| Làm tròn tổng điểm | 2 chữ số thập phân, bỏ số 0 thừa (`4`, `3.5`, `3.75`) |
| Link sửa | **Code 6 số nằm trong URL**, mở link là vào thẳng trang sửa (code là bí mật) |
| Cập nhật Sheet khi sửa | **Có** — lưu vị trí dòng lúc append, khi xác nhận thì update ô Điểm |
| Cột Sheet | **Giữ cột Lớp** + thêm cột **Link xem kết quả web**. Link ảnh Drive vẫn giữ |
| Trạng thái | `auto_graded` lúc chấm tự động → `confirmed` khi giám thị lưu |
| Note web | Thêm dòng note tĩnh ở ResultDetailView (và ReviewView) |

## 3. State machine
```
        [/grading chấm xong]
                │  create(): status = auto_graded, reviewCode = NNNNNN (random unique)
                ▼
        ┌──────────────┐    PATCH /api/review/:code (giám thị lưu)
        │ auto_graded  │ ───────────────────────────────────────────►  ┌────────────┐
        └──────────────┘   applyReview(): cập nhật earnedPoints/từng     │ confirmed  │
                │           câu, totalScore, status=confirmed,           └────────────┘
                │           reviewedAt; update ô Điểm trong Sheet              │
                │                                                             │
                └─────────────── PATCH lại (sửa tiếp) ◄───────────────────────┘
                          confirmed có thể sửa lại nhiều lần (vẫn confirmed,
                          totalScore + Sheet cập nhật lại mỗi lần lưu).
```
Duplicate/repeat PATCH: idempotent theo nội dung gửi lên — luôn ghi đè earnedPoints
theo payload, tính lại totalScore, set confirmed. Không có khóa "đã xác nhận thì
không sửa được" (giám thị có thể sửa nhầm và sửa lại).

## 4. Schema (Mongoose — submission.schema.ts)
SubmissionQuestion thêm:
```ts
@Prop({ type: String, default: '' }) type!: string;          // loại câu (carry từ Exam)
@Prop({ type: Number, default: 0 }) earnedPoints!: number;   // điểm câu này, 0..1
```
Submission thêm:
```ts
@Prop({ type: String, default: 'auto_graded', index: true }) status!: string; // auto_graded | confirmed
@Prop({ type: String, required: true, unique: true, index: true }) reviewCode!: string; // 6 số
@Prop({ type: Number, default: 0 }) totalScore!: number;     // tổng điểm thực (sum earnedPoints)
@Prop({ type: Number, default: 0 }) maxScore!: number;       // = totalQuestions (mỗi câu 1đ)
@Prop({ type: String, default: '' }) sheetRange!: string;    // updatedRange lúc append, vd "Kết quả!A5:G5"
@Prop({ type: Date }) reviewedAt?: Date;
```
Lưu ý: `reviewCode` unique index. Sinh ngẫu nhiên 6 số, retry nếu trùng (E11000).

## 5. Payload / DTO shape
GET `/api/review/:code` → `ReviewDetail`:
```ts
interface ReviewDetail {
  id: string;
  status: 'auto_graded' | 'confirmed';
  fullName: string;
  className: string;
  examCode: string;
  totalScore: number;       // số thực
  maxScore: number;         // tổng câu
  scoreText: string;        // "3.75" (đã format 2dp, bỏ .00)
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
    earnedPoints: number;   // 0..1
    explanation: string;
  }[];
}
```
PATCH `/api/review/:code` body:
```ts
interface ReviewUpdate {
  questions: { id: string; isCorrect: boolean; earnedPoints: number }[]; // earnedPoints clamp [0,1]
}
```
→ trả lại `ReviewDetail` sau khi cập nhật.

## 6. Phase breakdown
| Phase | File | Mục tiêu | Phụ thuộc |
|---|---|---|---|
| 01 | phase-01-schema-service.md | Thêm field schema + logic review/score vào SubmissionService | — |
| 02 | phase-02-grade-sheets.md | Carry `type`/`earnedPoints` qua GradeService; Sheets append trả range + thêm updateCell | 01 |
| 03 | phase-03-discord-report.md | Discord ghi submission field mới, Sheet 7 cột + lưu range, embed 2 link + status | 01, 02 |
| 04 | phase-04-review-api.md | ReviewController GET/PATCH /api/review/:code + update Sheet ô điểm | 01, 02 |
| 05 | phase-05-web-ui.md | FE: note text, status badge, điểm; ReviewView sửa realtime | 01, 04 |

## 7. Phạm vi (In / Out)
**In scope:**
- src/submission/submission.schema.ts, submission.service.ts (field + method review).
- src/grade/grade.service.ts (carry type + earnedPoints vào GradedQuestion/GradeOutput).
- src/shared/google-sheets/google-sheets.service.ts (appendRow trả range, thêm updateCell).
- src/discord/discord.service.ts (input mới, Sheet 7 cột, lưu range, embed link sửa + status).
- src/results/review.controller.ts (MỚI), src/results/results.module.ts (đăng ký).
- src/results/results.controller.ts (toDetail thêm status/điểm — hiển thị, không sửa).
- web/src/App.tsx, api.ts, components/ResultDetailView.tsx (note + status + điểm), components/ReviewView.tsx (MỚI).

**Out of scope:**
- Không đổi cách tính điểm của Gemini (vẫn isCorrect mỗi câu); điểm lẻ chỉ do giám thị nhập tay.
- Không thêm auth/đăng nhập cho giám thị ngoài code 6 số trong URL.
- Không đổi danh sách công khai (`GET /api/results` list) sang hiển thị điểm — vẫn để như cũ trừ khi cần.
- Không refactor gộp "builder cột Sheet" dùng chung giữa append và update (update chỉ sửa ô Điểm).
- Không migrate dữ liệu submission cũ (thiếu reviewCode/totalScore — xử lý mềm: bản ghi cũ không có link sửa).

## 8. Risks
- **reviewCode trùng**: unique index + retry khi E11000 (tối đa ~5 lần). Acceptable.
- **Sheet range lệch** nếu ai đó chèn/xóa dòng thủ công giữa chừng → update sai ô. Acceptable (giám thị hiếm khi sửa Sheet tay); mitigation: chỉ update ô Điểm, log cảnh báo nếu update lỗi, không chặn luồng.
- **Code 6 số trong URL bị lộ** → người có link sửa được điểm. Theo yêu cầu (tiện cho giám thị). Mitigation: throttle endpoint, code tách biệt accessCode phụ huynh.
- **Submission cũ** không có reviewCode/totalScore: ReviewController trả 404 nếu không khớp code; ResultDetail fallback totalScore từ correctCount nếu thiếu.
- **earnedPoints ngoài [0,1]** từ client: clamp server-side trước khi tính tổng.
- **Append rồi mới set range**: create() chạy song song với appendRow (Discord). Phải set sheetRange SAU khi có range (thêm method setSheetRange). Nếu append lỗi → sheetRange rỗng, update Sheet bỏ qua.
