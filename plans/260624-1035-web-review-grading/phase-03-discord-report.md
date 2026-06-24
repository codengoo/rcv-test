# Phase 03 — Discord report: field mới, Sheet 7 cột, embed 2 link + status

**Goal:** `/grading` lưu submission với điểm thành phần + tổng điểm; ghi Sheet 7 cột (thêm Link xem kết quả web) và lưu lại `sheetRange`; embed báo trạng thái "Đã chấm tự động" + 2 link (xem kết quả + link sửa cho giám thị).

## 1. Files chạm vào
| File | Action |
|---|---|
| src/discord/discord.service.ts | MODIFY |

## 2. Thay đổi trong handleGrade (src/discord/discord.service.ts)
### 2a. Build submission input với field mới
`this.submissions.create({...})` thêm:
```ts
totalScore: result.totalScore,
maxScore: result.maxScore,
questions: result.questions, // đã có type + earnedPoints từ GradeService (phase 02)
```
(GradeOutput.questions giờ khớp SubmissionInput.questions — gồm type/earnedPoints.)

### 2b. Sheet row 7 cột — cột G = link xem kết quả web
Tính link web TRƯỚC khi ghi Sheet (cần submission id → đang lấy sau Promise.all).
Tách thứ tự: tạo submission trước, rồi append Sheet (để có id dựng link + lưu range).
Đề xuất cấu trúc lại bước 3:
```ts
// 3) Lưu Mongo trước (cần _id để dựng link web), best-effort.
const submission = await this.submissions
  .create({ /* ...input... */ })
  .catch((err: Error) => {
    this.logger.warn(`Lưu submission Mongo thất bại: ${err.message}`);
    return null;
  });

const resultId = submission?._id?.toString() ?? '';
const resultLink = resultId ? `${this.resultWebUrl}?result_id=${resultId}` : '';
const reviewLink = submission?.reviewCode
  ? `${this.resultWebUrl}?review_code=${submission.reviewCode}`
  : '';
const scoreText = formatScore(result.totalScore); // "3.75"

// 4) Ghi Sheet 7 cột rồi lưu lại range để sau update.
const row: CellValue[] = [
  result.fullName,    // A Họ tên HS
  result.parentName,  // B Tên bố/mẹ
  result.parentPhone, // C SĐT
  result.className,   // D Lớp
  `${scoreText} điểm`,// E Điểm bài làm
  imageLinks,         // F Link ảnh bài làm
  resultLink,         // G Link xem kết quả
];
try {
  const range = await this.sheets.appendRow(this.sheetId, this.sheetRange, row);
  this.logger.log(`✅ Đã ghi điểm "${result.fullName}" ${scoreText}đ vào sheet ${range}`);
  if (submission && range) await this.submissions.setSheetRange(resultId, range);
} catch (err) {
  this.logger.error(`Ghi Sheet thất bại: ${(err as Error).message}`);
}
```
> Lưu ý: bỏ `Promise.all([sheets.appendRow, submissions.create])` cũ vì giờ Sheet
> cần `_id` + reviewCode từ submission → chạy tuần tự (create rồi append). Chấm
> (Gemini) + upload Drive vẫn song song như cũ ở bước 2.

### 2c. Import formatScore
```ts
import { formatScore } from '../submission/submission.service';
```

### 2d. Embed: status + 2 link + điểm
- Description hiển thị điểm thực: `**Điểm:** ${scoreText}  •  **Mã đề:** ${examCode}`.
- Thêm field trạng thái: `{ name: 'Trạng thái', value: '🟡 Đã chấm tự động', inline: true }`.
- Field link:
```ts
if (resultLink) embed.addFields({ name: '🔗 Xem kết quả', value: resultLink });
if (reviewLink) embed.addFields({ name: '✍️ Cán bộ chấm thi sửa kết quả', value: reviewLink });
```

## 3. Encapsulation / wiring notes
- Dựng link sửa từ `RESULT_WEB_URL` (cùng domain web) + `?review_code=`. Không thêm env mới.
- `setSheetRange` chỉ gọi khi có submission + range hợp lệ.
- Giữ note ghi Mongo best-effort (không chặn reply nếu Mongo lỗi) — nhưng nếu Mongo lỗi thì không có link sửa/range (chấp nhận, log warn).

## 4. Acceptance criteria
- [ ] `npx tsc --noEmit` pass.
- [ ] Đọc lại handleGrade: tạo submission → dựng resultLink+reviewLink → append Sheet 7 cột → setSheetRange.
- [ ] Embed có field Trạng thái + 2 link; description hiển thị "X điểm".
- [ ] (Manual khi chạy thật) `/grading` ra embed có link `?review_code=NNNNNN`; Sheet có cột G link web; điểm dạng "X điểm".

## 5. Out of scope
- Backend xử lý link sửa (phase 04). FE (phase 05).

## 6. Commit message dự kiến
```
feat(discord): report kèm link sửa cho giám thị + Sheet 7 cột

handleGrade lưu submission (điểm thành phần/tổng điểm), ghi Sheet 7 cột (thêm
Link xem kết quả web) và lưu sheetRange để cập nhật sau. Embed báo trạng thái
"Đã chấm tự động" và 2 link: xem kết quả + link sửa ?review_code=NNNNNN.
Bỏ Promise.all create+append (append cần _id/reviewCode nên chạy tuần tự).
```
