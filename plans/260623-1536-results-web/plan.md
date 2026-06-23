# Trang web tra cứu kết quả thi (MongoDB + REST API + React FE)

**Date:** 2026-06-23 15:36 (GMT+7)
**Scope:** src (app.module, main, mới: database/mongo, exam, submission, results modules; quiz, grade, discord), web/ (React), package.json, .env(.example), src/config
**Trigger:** Hiện kết quả chấm chỉ nằm rải rác ở Google Sheet (điểm + link ảnh) và đề thi ở `database/*.json`. Cần 1 trang web để phụ huynh/HS tự tra cứu: xem danh sách thí sinh → click → nhập mật khẩu → xem chi tiết bài làm (ảnh 2 trang, đáp án từng câu + giải thích, ảnh zoom/fullscreen). Để có dữ liệu cho FE, chuyển đề thi + kết quả chấm sang MongoDB và mở HTTP API trong chính app NestJS.

## 1. Goal
Sau khi xong:
- App NestJS vừa chạy Discord bot vừa mở HTTP server (`app.listen`), phục vụ REST API + React build tĩnh.
- MongoDB là nguồn dữ liệu chính: collection `exams` (đề + đáp án + giải thích) và `submissions` (mỗi bài chấm 1 doc: thông tin thí sinh, điểm, chi tiết từng câu, ảnh Drive, accessCode).
- `/add-quiz` ghi đề vào Mongo; `/grading` đọc đáp án từ Mongo + lưu submission vào Mongo (vẫn ghi Sheet + upload Drive như cũ).
- REST: `GET /api/results` (danh sách công khai: tên, lớp, điểm, id) và `POST /api/results/:id/unlock` (body `{ code }` → đúng mới trả chi tiết).
- React FE (Vite+TS) tại `web/`: list → modal mật khẩu → trang chi tiết (ảnh zoom/fullscreen + bảng câu hỏi/đáp án/giải thích).

## 2. Quyết định đã chốt (từ Q&A)
| Câu hỏi | Lựa chọn |
|---|---|
| Lưu trữ | **MongoDB** cho cả đề thi lẫn kết quả. ODM: `@nestjs/mongoose` + `mongoose`. |
| Migrate dữ liệu cũ | Seed 1 lần `database/rcv-a01.json` vào Mongo. Sau đó Mongo là nguồn chính; `database/*.json` giữ làm backup, KHÔNG đọc nữa. |
| Mật khẩu khi thiếu ngày sinh | Công thức `ddMM(dob)+last2(parentPhone)`; thiếu thành phần → mặc định `"000000"`. Lưu `accessCode` sẵn trên mỗi submission. |
| Quyền xem | Danh sách công khai (chỉ tên/lớp/điểm/id). Chi tiết gated bằng accessCode. Không có admin login (phase này). |
| FE stack | **Vite + React + TypeScript** tại `web/`, build ra tĩnh, Nest serve. |
| Ảnh | Link Drive trực tiếp. Lưu thêm Drive `fileId` mỗi ảnh để FE dựng URL `https://drive.google.com/thumbnail?id=<id>&sz=w2000` (ổn định hơn `uc?export=view` cho `<img>`; fallback `uc?export=view&id=`). |
| HTTP | `main.ts`: `app.listen(PORT)` (env `PORT`, mặc định 3000). Serve `web/dist` tĩnh + prefix `/api` cho controller. |

## 3. Bảo mật accessCode (lưu ý)
- accessCode 6 chữ số từ dữ liệu bán-công-khai = YẾU. Kiểm tra LÀM Ở SERVER (`/unlock`), không bao giờ trả chi tiết kèm list.
- Thêm rate-limit theo IP cho `/unlock` (vd 10 lần/phút) để chống dò. Dùng `@nestjs/throttler`.
- List chỉ trả field tối thiểu (không SĐT, không ảnh, không đáp án).

## 4. Schema (Mongoose)
```ts
// exams collection — chuyển từ database/*.json
Exam {
  _id: ObjectId
  examCode: string   // unique, upper (vd "A01")
  title: string
  questions: [{
    id: string
    type: string
    question: string
    options: string[]
    correctAnswer: string
    explanation: string
  }]
  createdAt, updatedAt
}

// submissions collection — mỗi lần /grading 1 doc
Submission {
  _id: ObjectId
  examCode: string            // mã đề đã chấm
  fullName: string
  parentName: string
  parentPhone: string         // KHÔNG trả ra list
  className: string
  dob: string                 // "" nếu chưa có (ngày sinh ddMM hoặc rỗng)
  accessCode: string          // ddMM+last2phone hoặc "000000"
  score: string               // "9/12"
  correctCount: number
  totalQuestions: number
  questions: [{               // chi tiết chấm (từ GradingResult)
    id, studentAnswer, correctAnswer, isCorrect: boolean,
    question?: string, options?: string[], explanation?: string  // join từ Exam
  }]
  images: [{ fileId: string, link: string }]   // Drive
  note: string
  createdAt
}
```
Index: `exams.examCode` unique; `submissions.createdAt` desc; `submissions.examCode`.

## 5. API shape
```ts
// GET /api/results  → công khai
type ResultListItem = {
  id: string; fullName: string; className: string; score: string; examCode: string; createdAt: string;
};
// GET trả { items: ResultListItem[] }

// POST /api/results/:id/unlock  body { code: string }
// 200 → ResultDetail | 401 nếu sai code (rate-limited)
type ResultDetail = {
  id: string; fullName: string; className: string; examCode: string;
  score: string; correctCount: number; totalQuestions: number; note: string;
  images: { url: string }[];   // URL Drive đã dựng sẵn
  questions: {
    id: string; question: string; options: string[];
    studentAnswer: string; correctAnswer: string; isCorrect: boolean; explanation: string;
  }[];
};
```

## 6. Phase breakdown
| Phase | File | Mục tiêu | Phụ thuộc |
|---|---|---|---|
| 01 | phase-01-mongo-foundation.md | Cài mongoose + env `MONGODB_URI` + `MongooseModule.forRoot` + schema Exam/Submission. | — |
| 02 | phase-02-exam-to-mongo.md | ExamService(Mongo); QuizService ghi Mongo; GradeService đọc Mongo; seed `rcv-a01.json`. | 01 |
| 03 | phase-03-persist-submission.md | Lưu Submission khi /grading; capture Drive fileId; tính accessCode. | 02 |
| 04 | phase-04-rest-api.md | `app.listen` + serve static; ResultsController (list + unlock) + throttler. | 03 |
| 05 | phase-05-react-fe.md | Vite+React+TS `web/`: list → modal mật khẩu → detail + zoom ảnh; build + Nest serve. | 04 |

DAG tuyến tính 01→02→03→04→05.

## 7. Phạm vi (In / Out)
**In scope:**
- CREATE: `src/database/mongo.module.ts` (hoặc dùng MongooseModule trực tiếp trong app.module), `src/exam/` (schema+service+module), `src/submission/` (schema+service+module), `src/results/` (controller+module), `scripts/seed-exams.ts`, `web/` (React app).
- MODIFY: `src/app.module.ts`, `src/main.ts`, `src/quiz/quiz.service.ts` + module, `src/grade/grade.service.ts` + module, `src/discord/discord.service.ts` (capture fileId, gọi submissionService), `package.json`, `.env(.example)`, `src/config/env.validation.ts`.
**Out of scope:**
- Bỏ Google Sheet (vẫn ghi song song — không gỡ).
- Xóa file `database/*.json` (giữ làm backup).
- Admin login / chỉnh sửa kết quả qua web.
- Realtime / pagination nâng cao (list trả hết, sort theo createdAt).
- Tối ưu ảnh (task riêng `260623-1439-optimize-input-image`).

## 8. Risks
- **Cần MongoDB chạy** (local hoặc Atlas) → tài liệu `.env.example` + README; app fail-fast nếu không kết nối được (acceptable, log rõ).
- **Link Drive trực tiếp có thể bị Google đổi/giới hạn** → dùng `thumbnail?id=&sz=w2000`, fallback `uc?export=view`; nếu sau này hỏng → chuyển sang proxy (đã loại ở quyết định, có thể revisit).
- **accessCode yếu** → rate-limit + check server-side (mục 3). Acceptable cho nội bộ.
- **dob chưa được thu thập** → accessCode mặc định `000000` cho data hiện có; có thể bổ sung trích dob sau (task khác). Acceptable.
- **Migrate đề: ghi đè theo examCode** → seed idempotent (upsert theo examCode), chạy lại không nhân bản.
- **CORS dev**: FE Vite dev (5173) gọi API (3000) → bật CORS cho dev; prod serve cùng origin nên không cần.
