# Quiz Solver (/add-quiz) + Generic AI Shared Module

**Date:** 2026-06-22 17:40 (Asia/Ho_Chi_Minh)
**Scope:** src/shared/gemini, src/discord, src/quiz, src/config, package.json, .env.example, .gitignore, README.md, database/
**Trigger:** (1) Refactor: `src/gemini/` đang chứa logic domain hóa đơn — tách thành module AI **generic** ở `src/shared/`. (2) Task 3 mới: user gõ slash command `/add-quiz` đính kèm file đề (PDF/DOCX), AI giải đề → trả `{title, questionCount, markdown}`, lưu file markdown (đáp án + chỉ dẫn chấm) vào `database/`, bot reply embed báo tên đề + số câu đã giải.

## 1. Goal
Khi hoàn thành, chạy `npm run start:dev`:
- **Refactor:** `GeminiService` chuyển sang `src/shared/gemini/`, trở thành generic: `extractStructured(schema, parts, opts)` + helper dựng content part (`textPart/imagePart/mediaPart`). Schema/prompt hóa đơn rời về domain Discord. Task 2 (receipt) chạy y nguyên qua API generic mới.
- **Task 3:** Slash command `/add-quiz` (đăng ký theo guild `DISCORD_GUILD_ID`) nhận 1 attachment PDF hoặc DOCX. Bot:
  1. defer reply, tải file.
  2. PDF → gửi thẳng bytes cho Gemini (media part); DOCX → trích text bằng `mammoth` rồi gửi text.
  3. Gemini `gemini-2.0-flash` giải đề, trả structured `{ title, questionCount, markdown }`.
  4. Lưu `markdown` vào `database/<slug>-<timestamp>.md`.
  5. Reply **embed**: tiêu đề = tên đề, mô tả = "Đã giải N câu", field = tên file input + đường dẫn lưu.
- File không đúng định dạng / AI lỗi → reply embed lỗi (ephemeral), không crash.

## 2. Quyết định đã chốt (từ Q&A)
| Câu hỏi | Lựa chọn |
|---|---|
| AI module vị trí | `src/shared/gemini/` — generic, không dính domain (giống `src/shared/google-sheets/`) |
| API generic | `extractStructured<T>(schema, parts, {model?, name?})` + `textPart/imagePart/mediaPart` |
| Định dạng file /add-quiz | **PDF** (gửi native cho Gemini) + **DOCX** (mammoth → text). `.doc` legacy ngoài scope |
| Command scope | Guild-scoped qua `DISCORD_GUILD_ID` (hiện ngay); bot phải được mời với scope `applications.commands` |
| Output AI | Structured `{ title: string, questionCount: number, markdown: string }` |
| Nơi lưu | `database/` ở gốc dự án; tên `<slug(title)>-<timestamp>.md` |
| Phản hồi Discord | **Embed**: tên đề + số câu đã giải, reply lại lệnh; kèm tên file input + đường dẫn lưu |
| Model giải đề | `gemini-2.0-flash` |
| Receipt (task 2) | Giữ nguyên hành vi, chỉ đổi sang gọi `extractStructured` generic; schema về `src/discord/` |

## 3. State machine
Luồng `/add-quiz` (interaction):
```
InteractionCreate ──► [isChatInputCommand && name==='add-quiz'?] ──no──► ignore
                        │yes
                        ▼
              deferReply()  (đề có thể giải lâu > 3s)
                        ▼
        attachment = options.getAttachment('file')
                        ▼
        [mime là pdf hoặc docx?] ──no──► editReply(embed lỗi "định dạng không hỗ trợ")
                        │yes
                        ▼
              tải file → buffer
                        ▼
        pdf → mediaPart(base64,'application/pdf')
        docx → mammoth.extractRawText → textPart(text)
                        ▼
        gemini.extractStructured(quizSchema, [promptPart, inputPart])
              │success                         │fail (sau retry)
              ▼                                ▼
   lưu markdown → database/...md          editReply(embed lỗi)
              ▼
   editReply(embed: title, "Đã giải N câu", file input, path)
```
Slash command **không cần dedup** (mỗi interaction là duy nhất, Discord không re-emit). Không cần MessageContent intent cho interaction.

## 4. Schema
Không có DB. "Schema" gồm:
- **Output AI** (zod) — xem §5.
- **Layout file lưu:** `database/<slug>-<timestamp>.md`, nội dung = `markdown` thuần do AI sinh (đáp án từng câu + chỉ dẫn chấm).

## 5. Payload / DTO shape
```typescript
// src/quiz/quiz.schema.ts
import { z } from 'zod';

export const quizSolutionSchema = z.object({
  title: z
    .string()
    .describe('Tên/tiêu đề của đề thi; "" nếu không xác định'),
  questionCount: z
    .number()
    .describe('Tổng số câu hỏi đã giải trong đề'),
  markdown: z
    .string()
    .describe(
      'Toàn bộ lời giải dạng Markdown thân thiện với agent: mỗi câu gồm số câu, ' +
        'đề tóm tắt, đáp án đúng, và chỉ dẫn chấm điểm (rubric) rõ ràng',
    ),
});

export type QuizSolution = z.infer<typeof quizSolutionSchema>;
```

```typescript
// Generic AI part (src/shared/gemini)
export type AiPart = import('@langchain/core/messages').MessageContentComplex;
```

## 6. Phase breakdown
| Phase | File | Mục tiêu | Phụ thuộc |
|---|---|---|---|
| 01 | phase-01-shared-gemini-refactor.md | Move `src/gemini/`→`src/shared/gemini/`, generic `extractStructured`+part helpers; receipt schema về discord; task 2 chạy qua API mới | — (task 2 đã xong) |
| 02 | phase-02-quiz-service.md | `QuizModule`+`QuizService`: parse pdf/docx → parts, gọi `extractStructured(quizSchema)`, lưu markdown vào `database/`; deps `mammoth` | 01 |
| 03 | phase-03-add-quiz-command.md | Slash command `/add-quiz`: đăng ký guild, handle interaction, dispatch QuizService, reply embed; env `DISCORD_GUILD_ID`; README/.env | 01, 02 |

## 7. Bài học từ lần revert
Không áp dụng — chưa có plan trước bị revert. (Bài học nhỏ từ task 2: tránh `.nullable()` trong zod cho Gemini response_schema — áp dụng luôn cho `quizSolutionSchema`.)

## 8. Phạm vi (In / Out)
**In scope:**
- Move: `src/gemini/*` → `src/shared/gemini/*` (xóa `src/gemini/`)
- `src/shared/gemini/gemini.service.ts` generic; `src/shared/gemini/gemini.module.ts`
- `src/discord/receipt.schema.ts` (CREATE — chuyển từ gemini), `src/discord/discord.service.ts` (đổi call + thêm interaction handler), `src/discord/discord.module.ts` (imports)
- `src/quiz/quiz.schema.ts`, `src/quiz/quiz.service.ts`, `src/quiz/quiz.module.ts` (CREATE)
- `src/config/env.validation.ts` (+`DISCORD_GUILD_ID`)
- `package.json` (+`mammoth`)
- `.env.example`, `.env` (+`DISCORD_GUILD_ID`)
- `.gitignore` (+`database/`)
- `README.md`
- `database/` (thư mục đầu ra, tạo runtime nếu chưa có)

**Out of scope:**
- File `.doc` legacy (binary), `.txt`, ảnh trong /add-quiz (chỉ PDF + DOCX)
- Chấm bài tự động / so đáp án bài nộp (chỉ sinh đáp án + rubric)
- Lưu vào DB thật / index/tìm kiếm trong `database/`
- Đổi hành vi task 1 (message logging) & task 2 (chỉ refactor call-site)
- Phân quyền ai được dùng /add-quiz, rate limit

## 9. Risks
- **DOCX phức tạp (ảnh/bảng/công thức) → mammoth chỉ lấy text thô**, mất hình → AI thiếu dữ kiện. Mitigation: chấp nhận; khuyến nghị PDF cho đề có hình. Log cảnh báo nếu text rỗng.
- **PDF/đề quá lớn vượt giới hạn token/inline của Gemini** → lỗi API. Mitigation: extractStructured có retry; fail → embed lỗi, không crash. (Giới hạn inline ~20MB; Discord attachment thường < 25MB.)
- **AI đếm sai `questionCount` / `title`** → embed hiển thị sai. Mitigation: prompt rõ; chấp nhận sai số, file markdown vẫn là nguồn chính.
- **Slash command chưa xuất hiện** → bot chưa được mời với scope `applications.commands` hoặc sai `DISCORD_GUILD_ID`. Mitigation: README ghi rõ; log số command đã đăng ký lúc ready.
- **`database/` không ghi được (quyền)** → lưu fail. Mitigation: `mkdir recursive` trước khi ghi; lỗi → embed lỗi + log.
- **withStructuredOutput + zod deep type** (đã gặp ở task 2) → build lỗi. Mitigation: cast `any` quanh `withStructuredOutput` như task 2.
