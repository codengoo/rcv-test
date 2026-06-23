# Phase 03 — Lưu kết quả chấm (Submission) vào Mongo

**Goal:** Mỗi lần `/grading` thành công lưu 1 doc `submissions` (đủ chi tiết cho FE): thông tin thí sinh, điểm, chi tiết từng câu (+ join question/options/explanation từ Exam), ảnh Drive (fileId+link), accessCode.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/submission/submission.service.ts | CREATE (create, list, findByIdWithCode) |
| src/submission/submission.module.ts | CREATE (forFeature([Submission]) + export) |
| src/discord/discord.service.ts | MODIFY (capture Drive fileId; sau grade() gọi SubmissionService.create) |
| src/discord/discord.module.ts | MODIFY (import SubmissionModule) |
| src/grade/grade.service.ts | MODIFY (GradeOutput thêm question/options/explanation mỗi câu nếu chưa có — join từ Exam) |

## 2. Ý chính
- `uploadImagesToDrive` hiện trả `links` — đổi trả `{ fileId, link }[]` (DriveUpload đã có `id`, chỉ cần giữ lại). `loaded` (GradeImage) giữ nguyên.
- accessCode: helper `buildAccessCode(dob, parentPhone)` = `dob(ddMM) + last2(phone)`; thiếu → `"000000"`. dob hiện `""` → accessCode = `"000000"` (đúng quyết định).
- Sau `grade()` + ghi Sheet: build doc Submission từ GradeOutput + images(fileId/link) + accessCode → `SubmissionService.create`. Lỗi lưu submission KHÔNG được làm hỏng phản hồi chấm (try/catch, log warn).
- GradeOutput.questions cần kèm `question/options/explanation` (join từ Exam trong GradeService.grade) để submission đầy đủ. Nếu nặng, GradeService trả thêm map từ ExamService.findByExamCode.

## 3. Encapsulation / wiring notes
- DiscordService truy cập submission CHỈ qua SubmissionService.
- accessCode tính 1 chỗ (helper trong submission hoặc grade) — tránh lặp.

## 4. Acceptance criteria
- [ ] `npm run typecheck` + `npm run build` pass.
- [ ] `/grading` thật → 1 doc submission mới trong Mongo với: questions[] có isCorrect + explanation, images[] có fileId, accessCode `"000000"` (do dob rỗng).
- [ ] Lỗi Mongo khi lưu submission → bài chấm vẫn trả về Discord bình thường (regression).
- [ ] Link Drive trong images mở được ảnh.

## 5. Out of scope
- API public + FE (04/05). Trích dob (task khác).

## 6. Commit message dự kiến
```
feat(submission): persist grading results to MongoDB

Save one submission doc per /grading with candidate info, per-question
detail (joined with exam question/options/explanation), Drive image
fileId+link, and a precomputed accessCode (ddMM+last2phone, default
000000). Capture Drive fileId in uploadImagesToDrive. Submission save is
best-effort so grading never breaks.
```
