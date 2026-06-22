# Discord → Google Sheets Logger Bot

Bot server NestJS + discord.js: lắng nghe tin nhắn trong **một channel Discord cố định**, mỗi tin nhắn (không phải từ bot) được append thành 1 dòng vào một Google Sheet.

## Kiến trúc

```
Discord channel ──messageCreate──► DiscordService ──appendRow──► GoogleSheetsService ──► Google Sheet
                                   (lọc channel,                  (generic, googleapis,
                                    bỏ bot, dedup,                 service account, retry)
                                    map message→row)
```

- `src/discord/` — discord.js client, listener, dedup in-memory, map message → row.
- `src/shared/google-sheets/` — **generic** Google Sheets client (`googleapis`): append/get theo `spreadsheetId` + `range`, retry, auth từ service account. Dùng chung, không dính domain.
- `src/shared/gemini/` — **generic** AI client: `GeminiService.extractStructured(schema, parts)` (LangChain `@langchain/google-genai`) + helper `textPart/imagePart/mediaPart`. Dùng chung cho hóa đơn (task 2) và giải đề (task 3).
- `src/quiz/` — **QuizService**: parse PDF (native) / DOCX (mammoth), gọi Gemini giải đề, lưu markdown vào `database/`.
- `src/config/` — validate biến môi trường khi boot.

Mỗi message → 1 row. Cột A–F luôn có; nếu message kèm **ảnh hóa đơn**, bot dùng Gemini trích thêm cột G–K (xem [Trích xuất hóa đơn](#trích-xuất-hóa-đơn-bằng-gemini-task-2)):

| A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|
| timestamp (ISO) | author tag | authorId | channelId | messageId | content | storeName | storeAddress | date | total | currency |

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
| `DISCORD_CHANNEL_ID` | ID channel cần theo dõi (bật Developer Mode → chuột phải channel → Copy ID) |
| `DISCORD_GUILD_ID` | ID server để đăng ký slash command `/add-quiz` (chuột phải server → Copy Server ID) |
| `GOOGLE_SHEET_ID` | ID trong URL sheet: `docs.google.com/spreadsheets/d/<ID>/edit` |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | (Tùy chọn) đường dẫn file service account JSON. Bỏ trống = `./service-account.json` |
| `GEMINI_API_KEY` | API key Gemini cho trích xuất hóa đơn. Lấy tại https://aistudio.google.com/apikey |

> Credentials Google nằm trong file **`service-account.json`** (đã được `.gitignore`), không để trong `.env`.

## Thiết lập Discord

1. https://discord.com/developers/applications → New Application → Bot → copy **token**.
2. Trong tab **Bot**, bật **Message Content Intent** (bắt buộc, nếu không `content` sẽ rỗng).
3. Mời bot vào server với quyền đọc tin nhắn ở channel mục tiêu (OAuth2 URL Generator: scope `bot`, permission `View Channel` + `Read Message History`).

## Thiết lập Google Sheets

1. Google Cloud Console → tạo project → bật **Google Sheets API**.
2. Tạo **Service Account** → Keys → Add Key → JSON. Tải file về, đặt tên **`service-account.json`** ở thư mục gốc dự án (`d:\rcv`).
3. Mở Google Sheet đích → **Share** → thêm `client_email` trong file đó với quyền **Editor**.
4. (Tuỳ chọn) Đặt header ở dòng 1 khớp thứ tự cột ở trên.

## Chạy

```bash
npm run start:dev    # dev, watch mode
npm run build && npm run start:prod   # production
```

Khi chạy đúng, log sẽ có:

```
[SheetsService] Connected to sheet "<tên sheet>"
[DiscordService] Discord logged in as <bot>#1234, watching channel <id>
```

Gửi 1 tin trong channel cố định → xuất hiện 1 row mới trong sheet.

## Trích xuất hóa đơn bằng Gemini (task 2)

Khi gửi tin nhắn **kèm ảnh hóa đơn** vào channel cố định, bot:

1. Tải ảnh `image/*` **đầu tiên** trong attachment.
2. Gửi cho Gemini `gemini-2.0-flash` (qua LangChain `withStructuredOutput` + zod schema).
3. Trích `storeName, storeAddress, date, total, currency` và append vào cột **G–K** của cùng row (sau A–F).

```
ảnh ──► DiscordService.tryExtractReceipt ──► GeminiService.extractStructured ──► [G..K]
                                              (gemini-2.0-flash, receiptSchema)
```

- Cần điền `GEMINI_API_KEY` thật trong `.env`.
- Message **không có ảnh** → chỉ ghi A–F như cũ.
- Trích xuất lỗi (Gemini lỗi/quota, ảnh tải fail, ảnh không phải hóa đơn) → **vẫn ghi A–F**, log warning, không crash.
- Chỉ xử lý **một ảnh** mỗi message (ảnh đầu tiên); các attachment còn lại bị bỏ qua.

## Giải đề bằng `/add-quiz` (task 3)

Gõ slash command **`/add-quiz`** trong server và đính kèm file đề **PDF** hoặc **DOCX**. Bot:

1. `deferReply` (giải đề có thể > 3s), tải file đính kèm.
2. PDF → gửi thẳng bytes cho Gemini (`mediaPart`); DOCX → trích text bằng `mammoth`.
3. `gemini-2.0-flash` giải đề, trả structured `{ title, questionCount, markdown }`.
4. Lưu `markdown` (đáp án + chỉ dẫn chấm) vào `database/<slug>-<timestamp>.md`.
5. Reply **embed**: tên đề + số câu đã giải + tên file input + đường dẫn lưu.

```
/add-quiz (file) ──► DiscordService.handleAddQuiz ──► QuizService.solveAndSave ──► database/*.md
                                                       (parse pdf/docx + Gemini)        + embed reply
```

**Thiết lập:**
- Điền `DISCORD_GUILD_ID` trong `.env` (Server ID).
- Mời bot với **cả 2 scope** `bot` + **`applications.commands`** (OAuth2 URL Generator) — nếu thiếu, slash command sẽ không xuất hiện.
- File `.md` được lưu trong thư mục `database/` (đã `.gitignore`).

**Giới hạn:**
- Chỉ nhận **PDF + DOCX** (file khác → embed báo "Định dạng không hỗ trợ"). `.doc` legacy, `.txt`, ảnh: ngoài phạm vi.
- DOCX chỉ lấy **text thô** (mất hình/bảng phức tạp) — đề có hình nên dùng PDF.
- `title`/`questionCount` do AI suy ra, có thể sai số; file markdown là nguồn chính.
- Lỗi (AI/quota/parse) → embed báo lỗi, không crash.

## Hành vi & giới hạn

- Chỉ xử lý tin trong `DISCORD_CHANNEL_ID`; channel khác bị bỏ qua.
- Bỏ qua mọi tin từ bot (`author.bot`).
- Dedup theo `messageId` bằng in-memory Set (cap 5000) — **reset khi restart**.
- Append có retry exponential backoff 3 lần; fail hẳn thì log lỗi, không crash.
- Lỗi kết nối Sheet lúc boot chỉ cảnh báo; sẽ thử lại ở lần append đầu.

## Scripts

| Lệnh | Tác dụng |
|---|---|
| `npm run start:dev` | Chạy watch mode |
| `npm run build` | Compile sang `dist/` |
| `npm run start:prod` | Chạy bản build |
| `npm run typecheck` | `tsc --noEmit` |
