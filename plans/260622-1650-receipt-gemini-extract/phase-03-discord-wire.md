# Phase 03 — Wire Gemini vào DiscordService + README

**Goal:** Sau phase này, message có ảnh `image/*` trong channel cố định sẽ được tải ảnh, gọi `GeminiService.extractReceipt`, và append thêm cột G–K vào cùng row. Message không ảnh / extract fail vẫn ghi A–F như cũ. README có mục Gemini.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/discord/discord.module.ts | MODIFY (import GeminiModule) |
| src/discord/discord.service.ts | MODIFY (inject GeminiService + nhánh xử lý ảnh) |
| README.md | MODIFY (mục Gemini + cột G–K + env) |

## 2. src/discord/discord.module.ts
```typescript
import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { GoogleSheetsModule } from '../shared/google-sheets/google-sheets.module';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [GoogleSheetsModule, GeminiModule],
  providers: [DiscordService],
})
export class DiscordModule {}
```

## 3. src/discord/discord.service.ts — thay đổi cụ thể
**3a.** Thêm import + inject:
```typescript
import { GeminiService } from '../gemini/gemini.service';
import type { CellValue } from '../shared/google-sheets/google-sheets.service';
```
Constructor thêm tham số:
```typescript
  constructor(
    private readonly config: ConfigService,
    private readonly sheets: GoogleSheetsService,
    private readonly gemini: GeminiService,
  ) {
```

**3b.** Trong `handleMessage`, sau khi build base row, thay block append hiện tại bằng:
```typescript
    try {
      if (!this.sheetRange) {
        this.sheetRange = await this.sheets.getFirstSheetTitle(this.sheetId);
      }
      // Cột A→F
      const row: CellValue[] = [
        message.createdAt.toISOString(),
        message.author.tag,
        message.author.id,
        message.channelId,
        message.id,
        message.content ?? '',
      ];

      // Nếu có ảnh → trích hóa đơn, nối cột G→K
      const receiptCells = await this.tryExtractReceipt(message);
      if (receiptCells) row.push(...receiptCells);

      await this.sheets.appendRow(this.sheetId, this.sheetRange, row);
      this.logger.debug(`Logged message ${message.id} to sheet`);
    } catch (err) {
      this.logger.error(
        `Không ghi được message ${message.id}: ${(err as Error).message}`,
      );
    }
```

**3c.** Thêm helper mới trong class:
```typescript
  /**
   * Nếu message có attachment image/* → tải ảnh đầu tiên, gọi Gemini, trả về
   * 5 cell G→K. Lỗi (download/Gemini) → log warning, trả null (fallback A–F).
   */
  private async tryExtractReceipt(
    message: Message,
  ): Promise<CellValue[] | null> {
    const image = message.attachments.find((a) =>
      a.contentType?.startsWith('image/'),
    );
    if (!image) return null;
    if (message.attachments.size > 1) {
      this.logger.debug(
        `Message ${message.id} có ${message.attachments.size} attachment, chỉ xử lý ảnh đầu tiên`,
      );
    }

    try {
      const res = await fetch(image.url);
      if (!res.ok) throw new Error(`tải ảnh fail HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const base64 = buf.toString('base64');
      const mime = image.contentType ?? 'image/jpeg';

      const data = await this.gemini.extractReceipt(base64, mime);
      this.logger.debug(
        `Trích hóa đơn message ${message.id}: store="${data.storeName}" total=${data.total}`,
      );
      // G→K
      return [
        data.storeName ?? '',
        data.storeAddress ?? '',
        data.date ?? '',
        data.total ?? '',
        data.currency ?? '',
      ];
    } catch (err) {
      this.logger.warn(
        `Trích hóa đơn message ${message.id} thất bại, ghi A–F: ${(err as Error).message}`,
      );
      return null;
    }
  }
```
> `fetch` / `Buffer` là global trên Node ≥ 20 (project yêu cầu ≥ 20) — không cần import.

## 4. README.md — bổ sung
- Mục mới "Trích xuất hóa đơn bằng Gemini (task 2)": ảnh trong channel → Gemini → cột G–K.
- Cập nhật bảng cột thành A–K (thêm storeName, storeAddress, date, total, currency).
- Thêm `GEMINI_API_KEY` vào bảng biến `.env` + bước lấy key (https://aistudio.google.com/apikey).
- Ghi rõ: chỉ ảnh đầu tiên được xử lý; extract fail vẫn log message.

## 5. Encapsulation / wiring notes
- DiscordService gọi Gemini **chỉ qua** `GeminiService.extractReceipt` — không import schema/LangChain trực tiếp.
- DiscordModule phải `imports: [GoogleSheetsModule, GeminiModule]` để Nest resolve được `GeminiService`.
- Dùng `CellValue[]` (type đã export từ google-sheets.service) cho row để khớp chữ ký `appendRow`.
- `remember(message.id)` vẫn gọi TRƯỚC khi xử lý ảnh (giữ nguyên vị trí cũ) → tránh gọi Gemini 2 lần khi re-emit.

## 6. Acceptance criteria
- [ ] `npm run typecheck` pass.
- [ ] `npm run build` pass.
- [ ] `npm run start:dev` boot OK; log "Discord logged in..." + "Connected to sheet...".
- [ ] Gửi message **chữ thường** (không ảnh) trong channel → 1 row A–F (regression task 1 còn nguyên).
- [ ] Gửi message **kèm ảnh hóa đơn** → 1 row có thêm G–K điền store/total (cần `GEMINI_API_KEY` thật).
- [ ] Gửi ảnh KHÔNG phải hóa đơn / Gemini lỗi → vẫn có row A–F, log warning, app không crash.

## 7. Out of scope (phase này)
- Xử lý nhiều ảnh / nhiều hóa đơn trong 1 message.
- Lưu ảnh gốc, tạo cột link ảnh.
- Header tự động trong sheet.

## 8. Commit message dự kiến
```
feat(discord): extract receipt image via Gemini, append cols G–K

DiscordService giờ inject GeminiService: message có attachment image/*
được tải, gửi Gemini trích storeName/storeAddress/date/total/currency và
nối vào cùng row (cột G–K) trên cùng worksheet. Message không ảnh hoặc
extract fail vẫn ghi A–F như cũ (task 1 không đổi). README cập nhật.
```
