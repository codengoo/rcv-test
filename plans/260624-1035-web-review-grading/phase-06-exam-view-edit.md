# Phase 06 — Xem & sửa đề cho /add-quiz (đáp án + giải thích)

**Goal:** /add-quiz báo kèm 2 link: xem đề (đáp án + giải thích, công khai theo
examCode) và sửa đề (code 6 số trong URL) cho cán bộ sửa đáp án + lời giải.
Sửa đề KHÔNG chấm lại bài cũ; mỗi câu vẫn 1 điểm (không thêm điểm/câu).

## Quyết định (Q&A vòng 3)
| Câu hỏi | Lựa chọn |
|---|---|
| "Điểm số của đề" | Giữ 1đ/câu — chỉ sửa **đáp án + giải thích** (không thêm điểm/câu) |
| Sửa đề ảnh hưởng bài cũ | **Không** — chỉ áp dụng lần chấm sau |
| Link xem đề | Công khai theo `?exam_code=A02` |
| Link sửa đề | `?exam_edit=NNNNNN` (code 6 số trong URL = quyền) |

## Files
| File | Action |
|---|---|
| src/exam/exam.schema.ts | MODIFY (thêm editCode unique sparse) |
| src/exam/exam.service.ts | MODIFY (sinh editCode khi upsert; findByEditCode; updateAnswers) |
| src/exam/exam.controller.ts | CREATE (GET /api/exam/:code, GET/PATCH /api/exam-edit/:code) |
| src/exam/exam.module.ts | MODIFY (đăng ký ExamController) |
| src/app.module.ts | MODIFY (import ExamModule để controller load) |
| src/quiz/quiz.service.ts | MODIFY (QuizResult thêm editCode; save() trả doc) |
| src/discord/discord.service.ts | MODIFY (embed /add-quiz thêm 2 link) |
| web/src/api.ts | MODIFY (getExam/getExamForEdit/saveExam + types) |
| web/src/App.tsx | MODIFY (?exam_code / ?exam_edit) |
| web/src/components/ExamView.tsx | CREATE |
| web/src/components/ExamEditView.tsx | CREATE |

## API
- GET `/api/exam/:examCode` → `{ examCode, title, questions: [{id,type,question,options,correctAnswer,explanation}] }`. 404 nếu không có.
- GET `/api/exam-edit/:code` → như trên (tra theo editCode 6 số). 404 nếu sai code.
- PATCH `/api/exam-edit/:code` body `{ questions: [{id, correctAnswer, explanation}] }` → cập nhật, trả lại đề. Throttle.

## editCode
6 số, unique **sparse** (đề cũ chưa có vẫn hợp lệ). Khi upsert: giữ editCode cũ
nếu đã có (link ổn định), else sinh mới duy nhất (uniqueEditCode retry).

## Acceptance
- [ ] `tsc --noEmit` backend pass; `npm run build` web pass.
- [ ] /add-quiz embed có 2 link `?exam_code=` + `?exam_edit=`.
- [ ] (Manual) mở link xem → thấy đáp án + giải thích; mở link sửa → đổi đáp án/giải thích → lưu → GET lại thấy đã đổi; bài đã chấm cũ không đổi.

## Out of scope
- Không sửa câu hỏi/đáp án trắc nghiệm options, không thêm/xóa câu.
- Không chấm lại submission cũ.
- Không thêm điểm/câu vào đề.
