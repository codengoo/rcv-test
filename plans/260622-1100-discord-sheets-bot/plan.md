# Discord → Google Sheets Logger Bot

**Date:** 2026-06-22 11:00 (Asia/Ho_Chi_Minh)
**Scope:** d:\rcv (greenfield), src/, package.json, tsconfig.json, .env.example
**Trigger:** Cần một bot server NestJS lắng nghe tin nhắn trong MỘT channel Discord cố định. Mỗi khi có tin nhắn (không phải từ bot), bot append một dòng metadata vào một sheet Google Sheets. Đây là project mới hoàn toàn, không có code cũ.

## 1. Goal
Khi hoàn thành, chạy `npm run start:dev` sẽ:
- Boot một NestJS app, kết nối Discord bằng bot token.
- Lắng nghe sự kiện `messageCreate` chỉ trên channel có id = `DISCORD_CHANNEL_ID`.
- Bỏ qua message từ bot/chính nó.
- Với mỗi message hợp lệ, append 1 row `[timestamp, author, authorId, channelId, messageId, content]` vào worksheet đầu tiên của Google Sheet `GOOGLE_SHEET_ID`, xác thực bằng service account.
- Chống ghi trùng theo `messageId` (in-memory) và retry khi Google API lỗi tạm thời.
Không có HTTP endpoint nghiệp vụ — đây là một worker/listener thuần.

## 2. Quyết định đã chốt (từ Q&A 1 vòng)
| Câu hỏi | Lựa chọn |
|---|---|
| Data shape mỗi row | Raw metadata: timestamp, author (tag), authorId, channelId, messageId, content |
| Google Sheets auth | Service Account qua **`googleapis`** (google.auth.GoogleAuth + keyFile), load từ file `service-account.json` (KHÔNG để key trong env) |
| Sheets handling | Generic `GoogleSheetsService` ở **`src/shared/google-sheets/`** (append/get theo spreadsheetId + range), không dính domain; Discord map message → row rồi gọi |
| Credentials | `service-account.json` ở thư mục gốc (gitignored); env chỉ giữ `GOOGLE_SHEET_ID` + optional `GOOGLE_SERVICE_ACCOUNT_FILE` |
| Reliability | Append + dedup theo messageId (in-memory Set có cap) + retry exponential backoff |
| Channel scope | Một channel cố định duy nhất (`DISCORD_CHANNEL_ID`); message khác channel bị bỏ qua |
| Bot messages | Bỏ qua mọi message có `author.bot === true` |
| Worksheet đích | Worksheet đầu tiên (index 0) của spreadsheet; header row do user tự tạo |
| NestJS / discord.js | NestJS v11, discord.js v14, TypeScript, @nestjs/config validate env |

## 3. State machine
Không có lifecycle DB phức tạp. Luồng xử lý 1 message:

```
messageCreate ──► [channel == CHANNEL_ID?] ──no──► drop
                        │yes
                        ▼
                 [author.bot?] ──yes──► drop
                        │no
                        ▼
            [messageId in seenSet?] ──yes──► drop (duplicate event)
                        │no
                        ▼
              add messageId to seenSet
                        ▼
        SheetsService.appendRow(row)  ──► retry(n) on transient error
                        │
              success ──┴── fail(after retries) ──► log error, KEEP id in set
```
Quy tắc duplicate trigger: Discord có thể re-emit `messageCreate` khi reconnect; `seenSet` (cap ~5000, FIFO evict) chặn append trùng trong phiên chạy. Sau restart set rỗng — chấp nhận (xem Risks).

## 4. Schema
Không có DB. "Schema" là layout cột của Google Sheet (user tự đặt header):
| Cột | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| Ý nghĩa | timestamp (ISO) | author tag | authorId | channelId | messageId | content |

## 5. Payload / DTO shape
```typescript
// Một row được append, đúng thứ tự cột A→F
export interface MessageRow {
  timestamp: string;   // ISO 8601, message.createdAt.toISOString()
  author: string;      // message.author.tag  (vd: "user#1234" hoặc username)
  authorId: string;    // message.author.id
  channelId: string;   // message.channelId
  messageId: string;   // message.id
  content: string;     // message.content (có thể rỗng nếu chỉ có attachment)
}
```

## 6. Phase breakdown
| Phase | File | Mục tiêu | Phụ thuộc |
|---|---|---|---|
| 01 | phase-01-scaffold-config.md | Scaffold NestJS project + ConfigModule validate env + bootstrap rỗng boot được | — |
| 02 | phase-02-sheets-service.md | SheetsModule: SheetsService xác thực service account, appendRow + retry | 01 |
| 03 | phase-03-discord-listener.md | DiscordModule: client login, listen channel cố định, dedup, wire vào SheetsService | 01, 02 |
| 04 | phase-04-googleapis-shared.md | Refactor: thay google-spreadsheet → googleapis, tách generic sheet handling vào shared module | 02, 03 |

## 7. Bài học từ lần revert
Không áp dụng — không có plan trước bị revert.

## 8. Phạm vi (In / Out)
**In scope:**
- `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.gitignore`, `.env.example`, `README.md`
- `src/main.ts`, `src/app.module.ts`
- `src/config/env.validation.ts`
- `src/shared/google-sheets/google-sheets.module.ts`, `src/shared/google-sheets/google-sheets.service.ts` (generic, googleapis)
- `src/discord/discord.module.ts`, `src/discord/discord.service.ts`
- (phase 02 tạo `src/sheets/*` rồi phase 04 thay bằng `src/shared/google-sheets/*` + xoá `src/sheets/`)

**Out of scope:**
- HTTP controllers / REST API nghiệp vụ
- Persistent dedup (DB/Redis) — dùng in-memory
- Parse nội dung message thành nhiều cột (đã chốt raw metadata)
- Multi-channel / multi-sheet routing
- Docker, CI, test infra
- Slash commands / phản hồi lại Discord

## 9. Risks
- **Restart làm mất seenSet** → có thể append trùng nếu Discord re-emit message cũ sau restart. Mitigation: chấp nhận; xác suất thấp vì gateway không replay message cũ sau login mới.
- **Service account chưa được share quyền Editor trên sheet** → append fail 403. Mitigation: README ghi rõ bước share sheet cho email service account; lỗi được log rõ ràng.
- **Google API rate limit (429) / lỗi mạng** → mất row. Mitigation: retry exponential backoff (3 lần); nếu vẫn fail thì log error (không crash).
- **Thiếu intent `MessageContent`** → `content` rỗng. Mitigation: README ghi bật "Message Content Intent" trong Developer Portal; code khai báo intent `GuildMessages` + `MessageContent`.
- **`service-account.json` thiếu/không đọc được** → SheetsService throw rõ ràng ("Không đọc được service account file ..."), boot chỉ log warning, append sẽ thử lại. File này phải nằm ở cwd và được gitignore.
