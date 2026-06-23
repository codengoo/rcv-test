# Discord Bot chấm bài thi → Google Sheets

Bot server NestJS + discord.js phục vụ chấm bài thi qua **slash command**:

- **`/add-quiz`** — tải lên đề (PDF/DOCX), Gemini giải đề và lưu **đáp án + chỉ dẫn chấm** dạng markdown vào `database/`.
- **`/grading`** — tải lên **ảnh bài làm** của thí sinh (chỉ ảnh, không nhập tay); Gemini đọc ảnh, **tự trích thông tin thí sinh** (họ tên, bố mẹ, SĐT, lớp, mã đề, câu trả lời) theo format chuẩn, đối chiếu đáp án trong `database/`, chấm điểm; bot ghi 1 dòng vào Google Sheet.

> Bot **không** còn lắng nghe tin nhắn channel — toàn bộ tương tác qua slash command.

## Kiến trúc

```
/add-quiz (PDF/DOCX) ─► DiscordService ─► QuizService ─► database/<slug>.md
                                          (parse pdf/docx + Gemini giải đề)

/grading (chỉ ảnh) ─► DiscordService ─► GradeService ─► Gemini ─► info + điểm
                      (tải ảnh, ghi sheet)  (đọc database/*.md, đọc ảnh,
                                             trích info thí sinh + chấm)
                                   │
                                   └─► GoogleSheetsService ─► Google Sheet (1 dòng)
```

- `src/discord/` — discord.js client, đăng ký + xử lý 2 slash command.
- `src/quiz/` — **QuizService**: parse PDF (native) / DOCX (mammoth), gọi Gemini giải đề, lưu markdown vào `database/`.
- `src/grade/` — **GradeService**: nạp toàn bộ đáp án `database/*.md`, gửi ảnh bài làm cho Gemini; AI trích thông tin thí sinh (tên, bố mẹ, SĐT, lớp, mã đề, câu trả lời) theo format chuẩn rồi đối chiếu đáp án để chấm điểm (mỗi câu 1 điểm theo chỉ dẫn chấm).
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

1. `deferReply` (giải đề có thể > 3s), tải file đính kèm.
2. PDF → gửi thẳng bytes cho Gemini (`mediaPart`); DOCX → trích text bằng `mammoth`.
3. `gemini-2.5-flash-lite` giải đề, trả structured `{ title, questionCount, markdown }`.
4. Lưu `markdown` (đáp án + chỉ dẫn chấm, có ghi **Mã đề**) vào `database/<slug>-<timestamp>.md`.
5. Reply **embed**: tên đề + số câu đã giải + tên file input + đường dẫn lưu.

**Giới hạn:**
- Chỉ nhận **PDF + DOCX** (file khác → embed báo "Định dạng không hỗ trợ").
- DOCX chỉ lấy **text thô** (mất hình/bảng phức tạp) — đề có hình nên dùng PDF.
- Lỗi (AI/quota/parse) → embed báo lỗi, không crash.

## Chấm bài bằng `/grading`

> Trước tiên phải dùng `/add-quiz` để có file đáp án `.md` trong `database/` (mỗi file ghi rõ **Mã đề**).

Gõ **`/grading`** và **chỉ đính ảnh bài làm** — không nhập tay thông tin thí sinh:

| Option | Bắt buộc | Ý nghĩa |
|---|---|---|
| `file` | ✅ | Ảnh bài làm (trang 1) |
| `file2`…`file5` | ❌ | Ảnh bài làm các trang tiếp theo (nếu nhiều trang) |

Bot:

1. `deferReply`, gom tất cả ảnh `image/*` từ `file`…`file5`, tải về.
2. `GradeService` nạp toàn bộ đáp án `database/*.md`, gửi ảnh + kho đáp án cho Gemini.
3. Gemini **trích thông tin thí sinh** từ ảnh (họ tên, bố mẹ, SĐT, lớp, mã đề, câu trả lời từng câu — quy chuẩn A/B/C/D cho trắc nghiệm), chọn đề khớp **Mã đề**, đối chiếu và chấm từng câu (mỗi câu 1 điểm).
4. Append 1 dòng `[Họ tên, Bố mẹ, SĐT, Lớp, Điểm, Link ảnh]` (thông tin do AI trích) vào Google Sheet.
5. Reply **embed**: tên + điểm (dạng `số câu đúng/tổng`), mã đề, file đáp án dùng, ghi chú.

**Giới hạn:**
- Toàn bộ thông tin thí sinh do **AI đọc từ ảnh** — bài làm cần ghi rõ họ tên/bố mẹ/SĐT/lớp/mã đề; thiếu sẽ để trống và ghi vào `note`.
- Chỉ đọc attachment **`image/*`**; option khác định dạng bị bỏ qua.
- Điểm dạng **`số câu đúng / tổng`** (vd `9/12`).
- Link ảnh dùng **URL discord** (`cdn.discordapp.com`) — URL này có chữ ký và **có thể hết hạn** theo thời gian.
- `database/` chưa có đáp án nào → embed báo lỗi, yêu cầu chạy `/add-quiz` trước.
- AI đọc sai chữ viết tay / mã đề là rủi ro chấp nhận được — dùng `note` + embed để giám khảo soát lại.
- Lỗi (AI/quota/tải ảnh/ghi sheet) → embed báo lỗi, không crash.

## Hành vi & giới hạn chung

- Toàn bộ tương tác qua slash command theo `DISCORD_GUILD_ID`.
- Append có retry exponential backoff 3 lần; fail hẳn thì log lỗi, không crash.
- Lỗi kết nối Sheet lúc boot chỉ cảnh báo; sẽ thử lại ở lần append đầu.
- File `.md` trong `database/` (đã `.gitignore`).

## Scripts

| Lệnh | Tác dụng |
|---|---|
| `npm run start:dev` | Chạy watch mode |
| `npm run build` | Compile sang `dist/` |
| `npm run start:prod` | Chạy bản build |
| `npm run typecheck` | `tsc --noEmit` |
