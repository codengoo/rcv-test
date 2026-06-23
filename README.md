# Discord Bot chấm bài thi → Google Sheets

Bot server NestJS + discord.js phục vụ chấm bài thi qua **slash command**:

- **`/add-quiz`** — tải lên đề (PDF/DOCX), Gemini trích **cấu trúc đề** và lưu file **JSON minified** vào `database/` (tên đề, mã đề, từng câu: đề bài, lựa chọn, đáp án đúng, giải thích).
- **`/grading`** — **nhập tay mã đề** + tải **ảnh bài làm**; Gemini đọc ảnh, **trích thông tin thí sinh** (họ tên, bố mẹ, SĐT, lớp, mã đề để đối chiếu, câu trả lời) và chấm điểm bằng cách so với đáp án trong JSON; bot ghi 1 dòng vào Google Sheet.

> Bot **không** còn lắng nghe tin nhắn channel — toàn bộ tương tác qua slash command.

## Kiến trúc

```
/add-quiz (PDF/DOCX) ─► DiscordService ─► QuizService ─► database/<slug>.json
                                          (parse pdf/docx + Gemini trích cấu trúc đề)

/grading (mã đề + ảnh) ─► DiscordService ─► GradeService ─► Gemini ─► info + điểm
                          (tải ảnh, ghi sheet)  (load đáp án tối giản theo mã đề,
                                                 đọc ảnh, trích info thí sinh + chấm)
                                   │
                                   └─► GoogleSheetsService ─► Google Sheet (1 dòng)
```

- `src/discord/` — discord.js client, đăng ký + xử lý 2 slash command.
- `src/quiz/` — **QuizService**: parse PDF (native) / DOCX (mammoth), gọi Gemini trích **cấu trúc đề** (`examSchema`), lưu JSON minified vào `database/`. Hỗ trợ 3 loại câu: `multiple_choice`, `fill_blank`, `error_correction`.
- `src/grade/` — **GradeService**: theo **mã đề nhập tay**, đọc đúng file JSON và chỉ lấy `{id, type, correctAnswer}` (không tải nội dung đề), gửi cùng ảnh cho Gemini **một lần gọi**; AI trích thông tin thí sinh + mã đề (đối chiếu) rồi so đáp án để chấm (mỗi câu 1 điểm).
- `src/shared/gemini/` — **generic** AI client: `GeminiService.extractStructured(schema, parts)` (LangChain `@langchain/google-genai`) + helper `textPart/imagePart/mediaPart`. Dùng chung cho giải đề và chấm bài.
- `src/shared/google-sheets/` — **generic** Google Sheets client (`googleapis`): append/get theo `spreadsheetId` + `range`, retry, auth từ service account.
- `src/config/` — validate biến môi trường khi boot.

Mỗi lần `/grading` → **1 dòng** trong Google Sheet:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Họ tên thí sinh | Bố mẹ | SĐT bố mẹ | Lớp | Điểm (vd `9/12`) | Link ảnh bài làm (cdn discord, nối nhiều ảnh bằng xuống dòng) |

## Yêu cầu

- Node.js ≥ 20 (đã test trên 24), npm ≥ 10.

## Cài đặt

```bash
npm install
cp .env.example .env   # rồi điền giá trị thật
```

## Cấu hình `.env`

| Biến | Mô tả |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token từ Discord Developer Portal |
| `DISCORD_GUILD_ID` | ID server để đăng ký slash command (chuột phải server → Copy Server ID) |
| `GOOGLE_SHEET_ID` | ID trong URL sheet: `docs.google.com/spreadsheets/d/<ID>/edit` |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | (Tùy chọn) đường dẫn file service account JSON. Bỏ trống = `./service-account.json` |
| `GEMINI_API_KEY` | API key Gemini cho giải đề + chấm bài. Lấy tại https://aistudio.google.com/apikey |

> Credentials Google nằm trong file **`service-account.json`** (đã được `.gitignore`), không để trong `.env`.

## Thiết lập Discord

1. https://discord.com/developers/applications → New Application → Bot → copy **token**.
2. Mời bot vào server với **cả 2 scope** `bot` + **`applications.commands`** (OAuth2 URL Generator) — nếu thiếu, slash command sẽ không xuất hiện.
3. Bot chỉ dùng slash command nên **không cần** Message Content Intent (có thể tắt).

## Thiết lập Google Sheets

1. Google Cloud Console → tạo project → bật **Google Sheets API**.
2. Tạo **Service Account** → Keys → Add Key → JSON. Tải file về, đặt tên **`service-account.json`** ở thư mục gốc dự án (`d:\rcv`).
3. Mở Google Sheet đích → **Share** → thêm `client_email` trong file đó với quyền **Editor**.
4. (Tuỳ chọn) Đặt header ở dòng 1 khớp thứ tự cột ở trên: Họ tên thí sinh | Bố mẹ | SĐT bố mẹ | Lớp | Điểm | Link ảnh.

## Chạy

```bash
npm run start:dev    # dev, watch mode
npm run build && npm run start:prod   # production
```

Khi chạy đúng, log sẽ có:

```
[SheetsService] Connected to sheet "<tên sheet>"
[DiscordService] Discord logged in as <bot>#1234
[DiscordService] Đã đăng ký /add-quiz + /grading cho guild <id>
```

## Giải đề bằng `/add-quiz`

Gõ slash command **`/add-quiz`** trong server và đính kèm file đề **PDF** hoặc **DOCX**. Bot:

1. `deferReply` (trích đề có thể > 3s), tải file đính kèm.
2. PDF → gửi thẳng bytes cho Gemini (`mediaPart`); DOCX → trích text bằng `mammoth`.
3. `gemini-2.5-flash-lite` trích cấu trúc đề theo `examSchema`, trả `{ title, examCode, questions[] }`.
4. Lưu **JSON minified** vào `database/<slug>-<timestamp>.json`. Mỗi câu gồm `id`, `type` (`multiple_choice`/`fill_blank`/`error_correction`), `question`, `options`, `correctAnswer`, `explanation`.
5. Reply **embed**: tên đề + mã đề + số câu + tên file input + đường dẫn JSON.

**Giới hạn:**
- Chỉ nhận **PDF + DOCX** (file khác → embed báo "Định dạng không hỗ trợ").
- DOCX chỉ lấy **text thô** (mất hình/bảng phức tạp) — đề có hình nên dùng PDF.
- `title`/`examCode`/`type` do AI suy ra, có thể sai số — kiểm tra lại file JSON nếu cần.
- Lỗi (AI/quota/parse) → embed báo lỗi, không crash.

## Chấm bài bằng `/grading`

> Trước tiên phải dùng `/add-quiz` để có file đáp án `.json` trong `database/` (mỗi file có **Mã đề**).

Gõ **`/grading`**, **nhập tay mã đề** và đính ảnh bài làm:

| Option | Bắt buộc | Ý nghĩa |
|---|---|---|
| `file` | ✅ | Ảnh bài làm (trang 1) |
| `exam_code` | ✅ | Mã đề (vd `A01`) — chọn file đáp án để chấm |
| `file2`…`file5` | ❌ | Ảnh bài làm các trang tiếp theo (nếu nhiều trang) |

Bot:

1. `deferReply`, gom tất cả ảnh `image/*` từ `file`…`file5`, tải về.
2. `GradeService` đọc file JSON khớp `exam_code`, chỉ lấy `{id, type, correctAnswer}` (không tải nội dung đề).
3. **Một lần gọi** Gemini với ảnh + đáp án tối giản: AI **trích thông tin thí sinh** (họ tên, bố mẹ, SĐT, lớp, mã đề — để đối chiếu), đọc câu trả lời từng câu (quy chuẩn A/B/C/D cho trắc nghiệm) và chấm (mỗi câu 1 điểm).
4. Append 1 dòng `[Họ tên, Bố mẹ, SĐT, Lớp, Điểm, Link ảnh]` (thông tin do AI trích) vào Google Sheet.
5. Reply **embed**: tên + điểm (dạng `số câu đúng/tổng`), mã đề nhập tay, file đáp án dùng, **mã đề AI đọc trên ảnh** (cảnh báo nếu lệch), ghi chú.

**Giới hạn:**
- Thông tin thí sinh do **AI đọc từ ảnh** — bài làm cần ghi rõ họ tên/bố mẹ/SĐT/lớp; thiếu sẽ để trống và ghi vào `note`.
- Mã đề **nhập tay** quyết định đáp án dùng; mã đề AI đọc từ ảnh chỉ để **đối chiếu** (lệch → cảnh báo, vẫn chấm theo mã nhập tay).
- Chỉ đọc attachment **`image/*`**; option khác định dạng bị bỏ qua.
- Điểm dạng **`số câu đúng / tổng`** (vd `9/12`).
- Link ảnh dùng **URL discord** (`cdn.discordapp.com`) — URL này có chữ ký và **có thể hết hạn** theo thời gian.
- Không tìm thấy mã đề trong `database/` → embed báo lỗi kèm danh sách mã đề hiện có.
- Lỗi (AI/quota/tải ảnh/ghi sheet) → embed báo lỗi, không crash.

## Hành vi & giới hạn chung

- Toàn bộ tương tác qua slash command theo `DISCORD_GUILD_ID`.
- Append có retry exponential backoff 3 lần; fail hẳn thì log lỗi, không crash.
- Lỗi kết nối Sheet lúc boot chỉ cảnh báo; sẽ thử lại ở lần append đầu.
- File `.json` đề trong `database/` (đã `.gitignore`).

## Scripts

| Lệnh | Tác dụng |
|---|---|
| `npm run start:dev` | Chạy watch mode |
| `npm run build` | Compile sang `dist/` |
| `npm run start:prod` | Chạy bản build |
| `npm run typecheck` | `tsc --noEmit` |
