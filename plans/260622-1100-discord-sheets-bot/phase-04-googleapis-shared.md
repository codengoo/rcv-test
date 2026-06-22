# Phase 04 — Refactor: googleapis + shared generic Sheets module

**Goal:** Thay thư viện `google-spreadsheet` bằng `googleapis` chính chủ, và tách toàn bộ phần xử lý Google Sheets generic ra một shared module (`src/shared/google-sheets/`). Sau phase này không còn `src/sheets/`; `DiscordService` map message → mảng giá trị rồi gọi `GoogleSheetsService` generic.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/shared/google-sheets/google-sheets.service.ts | CREATE |
| src/shared/google-sheets/google-sheets.module.ts | CREATE |
| src/discord/discord.service.ts | MODIFY (dùng GoogleSheetsService, map row, resolve range) |
| src/discord/discord.module.ts | MODIFY (import GoogleSheetsModule) |
| src/app.module.ts | MODIFY (bỏ SheetsModule) |
| src/sheets/ (cả thư mục) | DELETE |
| package.json | MODIFY (remove google-spreadsheet + google-auth-library, add googleapis) |

## 2. Thiết kế

### Generic service — không chứa domain
`GoogleSheetsService` chỉ biết `spreadsheetId` + `range` + `values`:
- `getFirstSheetTitle(spreadsheetId): Promise<string>` — qua `spreadsheets.get`, cũng dùng để verify kết nối.
- `appendRow(spreadsheetId, range, values: CellValue[]): Promise<void>` — qua `spreadsheets.values.append` (`valueInputOption: RAW`, `insertDataOption: INSERT_ROWS`), retry exponential backoff 3 lần, reset client nếu lỗi auth.
- Auth: `new google.auth.GoogleAuth({ keyFile, scopes })` với `keyFile` = `GOOGLE_SERVICE_ACCOUNT_FILE` ?? `service-account.json`; check `existsSync` để báo lỗi rõ.
- `CellValue = string | number | boolean | null`.

### Domain mapping ở DiscordService
- Đọc `GOOGLE_SHEET_ID` từ config (generic service KHÔNG hardcode id).
- `onModuleInit`: `sheetRange = await sheets.getFirstSheetTitle(sheetId)` → log `Connected to sheet "<title>"`; lỗi chỉ log.
- `handleMessage`: nếu `sheetRange` rỗng (boot verify fail) thì resolve lazy; map message → `[timestamp, author, authorId, channelId, messageId, content]` rồi `sheets.appendRow(sheetId, sheetRange, row)`.

## 3. Encapsulation / wiring notes
- `GoogleSheetsModule` `exports: [GoogleSheetsService]`. `DiscordModule` `imports: [GoogleSheetsModule]`.
- `AppModule` chỉ import `DiscordModule` (GoogleSheetsService warm-up chạy nhờ DiscordModule kéo theo).
- `GoogleSheetsService` tuyệt đối không import gì từ `discord/` — giữ generic, tái dùng cho module khác.
- `MessageRow` interface bị bỏ (mapping nằm inline ở DiscordService).

## 4. Acceptance criteria
- [x] `npm run typecheck` pass.
- [x] `npm run build` pass; `src/sheets/` không còn tồn tại.
- [x] Boot creds thật → log `Google Sheets client initialized`, `Connected to sheet "Sheet1"`, `Discord logged in as RCV#6584, watching channel ...`, không ERROR.
- [ ] (Manual, user tự test) Gửi tin trong channel → 1 row mới đúng 6 cột.

## 5. Out of scope
- Không đổi schema cột / hành vi dedup / intents.
- Không thêm read/update API (chỉ append + getFirstSheetTitle).

## 6. Commit message dự kiến
```
refactor(sheets): replace google-spreadsheet with googleapis, extract shared module

Tách Google Sheets handling generic vào src/shared/google-sheets/GoogleSheetsService
(googleapis: spreadsheets.values.append + spreadsheets.get, retry). DiscordService
map message → row và truyền spreadsheetId/range. Xoá src/sheets/, bỏ deps
google-spreadsheet + google-auth-library, thêm googleapis.
```
