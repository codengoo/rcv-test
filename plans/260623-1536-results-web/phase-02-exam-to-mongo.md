# Phase 02 — Đề thi chuyển sang Mongo (ExamService + seed)

**Goal:** Đề thi đọc/ghi qua MongoDB. `/add-quiz` lưu đề vào Mongo; `GradeService` lấy đáp án từ Mongo (thay vì đọc `database/*.json`). Seed 1 lần đề cũ `rcv-a01.json`.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/exam/exam.service.ts | CREATE (CRUD: upsertByExamCode, findByExamCode, listCodes) |
| src/exam/exam.module.ts | CREATE (MongooseModule.forFeature([Exam]) + export ExamService) |
| src/quiz/quiz.service.ts | MODIFY (thay `save()` ghi file → ExamService.upsert; vẫn giữ ghi .md tùy chọn) |
| src/quiz/quiz.module.ts | MODIFY (import ExamModule) |
| src/grade/grade.service.ts | MODIFY (loadAnswerKeys/listExams đọc từ ExamService thay readdir) |
| src/grade/grade.module.ts | MODIFY (import ExamModule) |
| scripts/seed-exams.ts | CREATE (đọc database/*.json → upsert Mongo, idempotent) |
| package.json | MODIFY (script `seed:exams`) |

## 2. Ý chính
- `ExamService`: `upsertByExamCode(exam)` (upsert theo examCode, không nhân bản), `findByExamCode(code)`, `listExams()` (examCode+title), `findMinimalForGrading(code)` (chỉ id/type/correctAnswer + explanation để join).
- QuizService: `solveAndSave` vẫn parse Markdown → Exam, nhưng `save()` gọi `ExamService.upsertByExamCode` thay vì ghi `database/<slug>.json`. (.md log có thể giữ hoặc bỏ — quyết định lúc thực thi; mặc định giữ để debug.)
- GradeService: bỏ `readdir(DB_DIR)`; `listExams()` + lấy đáp án từ ExamService. `grade()` lấy thêm `question/options/explanation` để sau này submission join được.
- Seed script: bootstrap Nest standalone (`NestFactory.createApplicationContext`) → ExamService.upsert cho từng file `database/*.json`.

## 3. Encapsulation / wiring notes
- QuizService/GradeService truy cập Mongo CHỈ qua `ExamService` (không inject Model trực tiếp).
- ExamModule export ExamService; QuizModule + GradeModule import ExamModule.

## 4. Acceptance criteria
- [ ] `npm run typecheck` + `npm run build` pass.
- [ ] `npm run seed:exams` → đề `A01` xuất hiện trong Mongo (chạy lại không nhân đôi).
- [ ] `/add-quiz` với 1 đề mới → doc Mongo tạo/cập nhật đúng examCode.
- [ ] `/grading` với mã `A01` → vẫn chấm đúng (đọc đáp án từ Mongo). Regression: luồng chấm + ghi Sheet không gãy.

## 5. Out of scope
- Lưu submission (phase 03). API/FE (04/05).

## 6. Commit message dự kiến
```
feat(exam): move exam answer-keys to MongoDB

Add ExamService/ExamModule (Mongoose) as the source of truth for exams.
QuizService now upserts parsed exams into Mongo; GradeService reads answer
keys from Mongo instead of database/*.json. Add seed:exams to import the
existing JSON files (idempotent upsert by examCode).
```
