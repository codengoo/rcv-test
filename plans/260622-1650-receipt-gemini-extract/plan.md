# Receipt Image → Gemini Extract → Google Sheets

**Date:** 2026-06-22 16:50 (Asia/Ho_Chi_Minh)
**Scope:** src/gemini, src/discord, src/config, package.json, .env.example, README.md
**Trigger:** Khi user gửi ảnh hóa đơn vào channel Discord cố định (cùng channel của task 1), bot phải tải ảnh, dùng Gemini (gemini-2.0-flash) qua LangChain trích xuất thông tin cửa hàng + tổng giá trị đơn, rồi append dữ liệu trích xuất vào CÙNG worksheet với log message (các cột nối tiếp sau A–F). Đây là task 2, xây trên nền task 1 đã hoàn thành.

## 1. Goal
Khi hoàn thành, chạy `npm run start:dev`:
- Task 1 hoạt động y nguyên: mọi message hợp lệ trong channel → 1 row `[timestamp, author, authorId, channelId, messageId, content]` (cột A–F).
- **Mới:** nếu message có **ảnh đính kèm** (attachment `image/*`), bot tải ảnh đầu tiên, gửi cho Gemini `gemini-2.0-flash` qua LangChain (`@langchain/google-genai`) với **structured output schema** (zod), trích `storeName, storeAddress, date, total, currency`, và append thêm các cột **G–K** vào CÙNG row đó.
- Message không có ảnh → ghi như cũ (chỉ A–F).
- Trích xuất lỗi (Gemini fail / ảnh không đọc được) → vẫn ghi A–F, log warning, KHÔNG crash, KHÔNG mất message log.
Không có HTTP endpoint mới — vẫn là listener thuần.

## 2. Quyết định đã chốt (từ Q&A 1 vòng)
| Câu hỏi | Lựa chọn |
|---|---|
| Loại ảnh + fields trích xuất | Hóa đơn (receipt): `storeName`, `storeAddress`, `date`, `total`, `currency` |
| Channel / Sheet đích | **Cùng channel, cùng worksheet** với task 1; receipt data nối tiếp vào cột G–K của cùng row |
| Gemini model | `gemini-2.0-flash` |
| API key | `GEMINI_API_KEY` đọc từ env (`.env`), validate khi boot (required) |
| AI stack | LangChain `@langchain/google-genai` + `@langchain/core` + `zod` schema (`withStructuredOutput`) |
| Module mới | `src/gemini/` — `GeminiModule` + `GeminiService.extractReceipt(imageBase64, mimeType)` |
| Số ảnh xử lý / message | Chỉ ảnh `image/*` ĐẦU TIÊN; các attachment khác bỏ qua (xem Risks) |
| Khi extract fail | Fallback ghi A–F + log warning; không chặn task 1 |
| Field thiếu trên hóa đơn | Schema cho phép null → map về chuỗi rỗng `''` (số `total` thiếu → `''`) |

## 3. State machine
Mở rộng luồng xử lý 1 message của task 1 (phần thêm in đậm):

```
messageCreate ──► [channel == CHANNEL_ID?] ──no──► drop
                        │yes
                        ▼
                 [author.bot?] ──yes──► drop
                        │no
                        ▼
            [messageId in seenSet?] ──yes──► drop
                        │no
                        ▼
              add messageId to seenSet
                        ▼
        baseRow = [ts, author, authorId, channelId, msgId, content]   (A–F)
                        ▼
        [có attachment image/* ?] ──no──► appendRow(baseRow)
                        │yes
                        ▼
        download ảnh đầu tiên → base64
                        ▼
        GeminiService.extractReceipt(base64, mime)
              │success                         │fail (sau retry)
              ▼                                ▼
   appendRow(baseRow + [store,addr,        appendRow(baseRow)  + log warning
             date,total,currency])            (G–K trống)
```
Dedup vẫn theo `seenSet` (cap 5000, FIFO) như task 1. `remember(id)` gọi TRƯỚC khi gọi Gemini → nếu Discord re-emit trong lúc đang xử lý ảnh sẽ không gọi Gemini 2 lần.

## 4. Schema
Không có DB. Column layout của worksheet đích (mở rộng task 1):

| Cột | A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ý nghĩa | timestamp | author | authorId | channelId | messageId | content | storeName | storeAddress | date | total | currency |

- Row message thường: chỉ ghi A–F (G–K không được set → để trống).
- Row có ảnh hóa đơn: ghi A–K.
- User tự thêm header dòng 1 nếu muốn.

## 5. Payload / DTO shape
```typescript
// src/gemini/receipt.schema.ts — zod schema = "form" output cho Gemini
import { z } from 'zod';

export const receiptSchema = z.object({
  storeName: z.string().nullable().describe('Tên cửa hàng / merchant trên hóa đơn'),
  storeAddress: z.string().nullable().describe('Địa chỉ cửa hàng nếu có'),
  date: z.string().nullable().describe('Ngày trên hóa đơn, giữ nguyên định dạng in trên bill'),
  total: z.number().nullable().describe('Tổng giá trị đơn (số, không kèm ký hiệu tiền tệ)'),
  currency: z.string().nullable().describe('Đơn vị tiền tệ, vd VND, USD'),
});

export type ReceiptData = z.infer<typeof receiptSchema>;
```
DiscordService map `ReceiptData` → mảng cell (null → `''`, `total` number giữ nguyên):
```typescript
[ data.storeName ?? '', data.storeAddress ?? '', data.date ?? '',
  data.total ?? '', data.currency ?? '' ]   // G→K
```

## 6. Phase breakdown
| Phase | File | Mục tiêu | Phụ thuộc |
|---|---|---|---|
| 01 | phase-01-deps-env.md | Thêm deps LangChain/Gemini/zod + env `GEMINI_API_KEY` (validate, .env.example); cài đặt, boot OK | — |
| 02 | phase-02-gemini-service.md | `GeminiModule` + `GeminiService.extractReceipt` (LangChain structured output, retry); export module | 01 |
| 03 | phase-03-discord-wire.md | Wire vào `DiscordService.handleMessage`: detect ảnh → download → extract → extend row G–K; import GeminiModule; README | 01, 02 |

## 7. Bài học từ lần revert
Không áp dụng — chưa có plan trước bị revert cho task này.

## 8. Phạm vi (In / Out)
**In scope:**
- `package.json` (thêm `@langchain/google-genai`, `@langchain/core`, `zod`)
- `.env.example` (thêm `GEMINI_API_KEY`)
- `src/config/env.validation.ts` (thêm field `GEMINI_API_KEY`)
- `src/gemini/gemini.module.ts`, `src/gemini/gemini.service.ts`, `src/gemini/receipt.schema.ts` (CREATE)
- `src/discord/discord.module.ts` (import GeminiModule)
- `src/discord/discord.service.ts` (thêm nhánh xử lý ảnh)
- `README.md` (mục Gemini + setup key)

**Out of scope:**
- Đổi format/cột của task 1 (A–F giữ nguyên)
- Xử lý >1 ảnh / nhiều attachment trong 1 message
- Loại ảnh khác hóa đơn (business card, generic…) — chốt làm hóa đơn trước
- Sheet/tab riêng, channel riêng — đã chốt dùng chung
- Persistent dedup, HTTP API, slash command, phản hồi lại Discord
- Lưu ảnh gốc xuống đĩa / Drive
- Test infra, Docker, CI

## 9. Risks
- **Gemini đọc sai số tổng / field hóa đơn mờ** → dữ liệu sai trong sheet. Mitigation: prompt rõ + schema có `.describe()`; chấp nhận sai số OCR, user kiểm tra lại trong sheet.
- **`GEMINI_API_KEY` thiếu** → boot fail (validate required). Mitigation: README ghi rõ; .env.example có sẵn key trống. Chấp nhận fail sớm để lộ misconfig.
- **Gemini API lỗi/timeout/quota** → không trích được. Mitigation: retry ngắn trong GeminiService; fail hẳn thì fallback ghi A–F + log warning, không mất message log, không crash.
- **Message có nhiều ảnh** → chỉ ảnh đầu tiên được xử lý. Mitigation: chấp nhận (đã out of scope); log debug số attachment bị bỏ.
- **Ảnh quá lớn / tải lỗi từ CDN Discord** → download fail. Mitigation: bọc try/catch quanh fetch, coi như extract fail → fallback A–F.
- **LangChain `withStructuredOutput` đổi API giữa version** → build lỗi. Mitigation: pin caret version đã test ở phase 01; typecheck là acceptance criterion.
