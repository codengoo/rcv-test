# Phase 02 — GeminiModule + GeminiService.extractReceipt

**Goal:** Sau phase này tồn tại `src/gemini/` với `GeminiModule` (export `GeminiService`) và `GeminiService.extractReceipt(imageBase64, mimeType)` trả về `ReceiptData` đã validate qua zod, dùng `gemini-2.0-flash` + LangChain structured output. Chưa wire vào Discord.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/gemini/receipt.schema.ts | CREATE |
| src/gemini/gemini.service.ts | CREATE |
| src/gemini/gemini.module.ts | CREATE |

## 2. src/gemini/receipt.schema.ts
```typescript
import { z } from 'zod';

/** "Form" output schema cho Gemini — các field cần trích từ ảnh hóa đơn. */
export const receiptSchema = z.object({
  storeName: z
    .string()
    .nullable()
    .describe('Tên cửa hàng / merchant in trên hóa đơn'),
  storeAddress: z
    .string()
    .nullable()
    .describe('Địa chỉ cửa hàng nếu có, ngược lại null'),
  date: z
    .string()
    .nullable()
    .describe('Ngày trên hóa đơn, giữ nguyên định dạng in trên bill'),
  total: z
    .number()
    .nullable()
    .describe('Tổng giá trị đơn dạng số, KHÔNG kèm ký hiệu tiền tệ hay dấu phân cách nghìn'),
  currency: z
    .string()
    .nullable()
    .describe('Đơn vị tiền tệ, vd "VND", "USD"; null nếu không xác định'),
});

export type ReceiptData = z.infer<typeof receiptSchema>;
```

## 3. src/gemini/gemini.service.ts
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage } from '@langchain/core/messages';
import { receiptSchema, ReceiptData } from './receipt.schema';

const MODEL = 'gemini-2.0-flash';
const MAX_RETRIES = 2;

const PROMPT =
  'Đây là ảnh một hóa đơn (receipt). Hãy trích xuất thông tin cửa hàng và ' +
  'tổng giá trị đơn theo đúng schema. Nếu một trường không có trên hóa đơn, ' +
  'trả về null cho trường đó. total phải là số thuần (bỏ ký hiệu tiền tệ và dấu phân cách).';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private model?: ReturnType<ChatGoogleGenerativeAI['withStructuredOutput']>;

  constructor(private readonly config: ConfigService) {}

  private getModel() {
    if (this.model) return this.model;
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    const llm = new ChatGoogleGenerativeAI({ model: MODEL, apiKey, temperature: 0 });
    this.model = llm.withStructuredOutput(receiptSchema, { name: 'receipt' });
    return this.model;
  }

  /**
   * Trích xuất dữ liệu hóa đơn từ ảnh (base64) qua Gemini + structured output.
   * Có retry ngắn; ném lỗi nếu vẫn fail sau MAX_RETRIES (caller tự fallback).
   */
  async extractReceipt(
    imageBase64: string,
    mimeType: string,
  ): Promise<ReceiptData> {
    const message = new HumanMessage({
      content: [
        { type: 'text', text: PROMPT },
        {
          type: 'image_url',
          image_url: `data:${mimeType};base64,${imageBase64}`,
        },
      ],
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = (await this.getModel().invoke([message])) as ReceiptData;
        return result;
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt === MAX_RETRIES) {
          this.logger.error(`extractReceipt fail sau ${MAX_RETRIES} lần: ${msg}`);
          throw err;
        }
        this.logger.warn(`extractReceipt lỗi (lần ${attempt}), retry: ${msg}`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    // Không bao giờ tới đây (loop hoặc return hoặc throw), thêm để TS yên tâm.
    throw new Error('extractReceipt: unreachable');
  }
}
```
> Lưu ý kỹ thuật: nếu `withStructuredOutput` báo lỗi type ở field `model`, cho phép dùng `any` cho biến `this.model` (LangChain trả union type phức tạp). Ưu tiên giữ type; chỉ nới lỏng nếu typecheck chặn.

## 4. src/gemini/gemini.module.ts
```typescript
import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';

@Module({
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}
```

## 5. Encapsulation / wiring notes
- `GeminiService` chỉ phụ thuộc `ConfigService` (đọc `GEMINI_API_KEY`). KHÔNG biết gì về Discord/Sheets.
- `ChatGoogleGenerativeAI` + structured model được lazy-init và cache (giống pattern lazy `getClient()` của GoogleSheetsService).
- KHÔNG import GeminiModule vào AppModule trực tiếp — sẽ được import bởi DiscordModule ở phase 03.
- `temperature: 0` để output ổn định.

## 6. Acceptance criteria
- [ ] `npm run typecheck` pass (cả file mới).
- [ ] `npm run build` pass; `dist/gemini/gemini.service.js` tồn tại.
- [ ] Import GeminiModule vào AppModule tạm thời (hoặc unit nhỏ) KHÔNG cần — thay vào đó: file compile sạch là đủ ở phase này.
- [ ] (Smoke, nếu có key thật) viết script tạm `node -e` dựng ChatGoogleGenerativeAI với model name không ném lỗi đồng bộ. Không bắt buộc gọi API thật ở phase này.

## 7. Out of scope (phase này)
- Không sửa DiscordService/DiscordModule (phase 03).
- Không download ảnh — service nhận sẵn base64.

## 8. Commit message dự kiến
```
feat(gemini): add GeminiService.extractReceipt via LangChain

Module src/gemini/ mới: receipt zod schema (storeName, storeAddress, date,
total, currency) + GeminiService dùng gemini-2.0-flash với
withStructuredOutput để trích xuất hóa đơn từ ảnh base64. Lazy-init model,
retry ngắn. Generic với domain Discord/Sheets — chỉ phụ thuộc ConfigService.
```
