# Phase 01 — Move Gemini → shared + generic API

**Goal:** `GeminiService` nằm ở `src/shared/gemini/`, generic (không biết hóa đơn/quiz). Có `extractStructured(schema, parts, opts)` + helper `textPart/imagePart/mediaPart`. Schema + prompt hóa đơn chuyển về `src/discord/`. Task 2 (receipt) vẫn append đúng cột G–K qua API mới. `tsc` + build pass.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/shared/gemini/gemini.service.ts | CREATE (generic, thay nội dung cũ) |
| src/shared/gemini/gemini.module.ts | CREATE |
| src/gemini/gemini.service.ts | DELETE |
| src/gemini/gemini.module.ts | DELETE |
| src/gemini/receipt.schema.ts | DELETE (chuyển nội dung sang discord) |
| src/discord/receipt.schema.ts | CREATE (nội dung receipt schema) |
| src/discord/discord.service.ts | MODIFY (import path mới + gọi extractStructured) |
| src/discord/discord.module.ts | MODIFY (import path GeminiModule mới) |

## 2. src/shared/gemini/gemini.service.ts (generic)
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, MessageContentComplex } from '@langchain/core/messages';
import { z } from 'zod';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const MAX_RETRIES = 2;

/** 1 phần nội dung gửi cho model (text / ảnh / media như PDF). */
export type AiPart = MessageContentComplex;

/**
 * Generic Gemini client (LangChain). Không chứa logic domain — nhận schema +
 * các content part, trả structured output đã validate. Dùng chung mọi module.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly llmCache = new Map<string, ChatGoogleGenerativeAI>();

  constructor(private readonly config: ConfigService) {}

  private getLlm(model: string): ChatGoogleGenerativeAI {
    const cached = this.llmCache.get(model);
    if (cached) return cached;
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    const llm = new ChatGoogleGenerativeAI({ model, apiKey, temperature: 0 });
    this.llmCache.set(model, llm);
    return llm;
  }

  // ---- Helpers dựng content part ----
  textPart(text: string): AiPart {
    return { type: 'text', text };
  }
  imagePart(base64: string, mimeType: string): AiPart {
    return { type: 'image_url', image_url: `data:${mimeType};base64,${base64}` };
  }
  /** Media inline (PDF, audio...) — google-genai map sang inlineData. */
  mediaPart(base64: string, mimeType: string): AiPart {
    return { type: 'media', mimeType, data: base64 } as unknown as AiPart;
  }

  /**
   * Gọi model với content parts, ép structured output theo zod schema.
   * Có retry ngắn; ném lỗi nếu vẫn fail sau MAX_RETRIES (caller tự xử lý).
   */
  async extractStructured<T>(
    schema: z.ZodType<T>,
    parts: AiPart[],
    opts?: { model?: string; name?: string },
  ): Promise<T> {
    const model = opts?.model ?? DEFAULT_MODEL;
    // cast any: tránh deep type instantiation của withStructuredOutput + zod.
    const structured = (this.getLlm(model) as any).withStructuredOutput(schema, {
      name: opts?.name ?? 'output',
    });
    const message = new HumanMessage({ content: parts });

    this.logger.log(
      `Gọi ${model} structured "${opts?.name ?? 'output'}" (${parts.length} part)...`,
    );
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = (await structured.invoke([message])) as T;
        this.logger.log(`${model} phản hồi OK (lần ${attempt})`);
        return result;
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt === MAX_RETRIES) {
          this.logger.error(`extractStructured fail sau ${MAX_RETRIES} lần: ${msg}`);
          throw err;
        }
        this.logger.warn(`extractStructured lỗi (lần ${attempt}), retry: ${msg}`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    throw new Error('extractStructured: unreachable');
  }
}
```

## 3. src/shared/gemini/gemini.module.ts
```typescript
import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';

@Module({
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}
```

## 4. src/discord/receipt.schema.ts (chuyển từ gemini, giữ nguyên — KHÔNG nullable)
```typescript
import { z } from 'zod';

/** Schema trích xuất hóa đơn (task 2). KHÔNG dùng .nullable() (Gemini reject). */
export const receiptSchema = z.object({
  storeName: z.string().describe('Tên cửa hàng / merchant in trên hóa đơn; "" nếu không có'),
  storeAddress: z.string().describe('Địa chỉ cửa hàng; "" nếu không có'),
  date: z.string().describe('Ngày trên hóa đơn, giữ nguyên định dạng in trên bill; "" nếu không có'),
  total: z.number().describe('Tổng giá trị đơn dạng số, bỏ ký hiệu tiền tệ và dấu phân cách; 0 nếu không xác định'),
  currency: z.string().describe('Đơn vị tiền tệ, vd "VND", "USD"; "" nếu không xác định'),
});

export type ReceiptData = z.infer<typeof receiptSchema>;
```

## 5. src/discord/discord.service.ts — thay đổi call-site
- Đổi import:
```typescript
import { GeminiService } from '../shared/gemini/gemini.service';
import { receiptSchema } from './receipt.schema';
```
- Thêm const prompt (đưa từ gemini cũ về discord, vì nó là domain hóa đơn):
```typescript
const RECEIPT_PROMPT =
  'Đây là ảnh một hóa đơn (receipt). Hãy trích xuất thông tin cửa hàng và ' +
  'tổng giá trị đơn theo đúng schema. Nếu một trường không có: trả "" cho text, 0 cho total. ' +
  'total phải là số thuần (bỏ ký hiệu tiền tệ và dấu phân cách nghìn).';
```
- Trong `tryExtractReceipt`, thay lời gọi:
```typescript
      const data = await this.gemini.extractStructured(
        receiptSchema,
        [this.gemini.textPart(RECEIPT_PROMPT), this.gemini.imagePart(base64, mime)],
        { name: 'receipt' },
      );
```
(Phần log `[4/6] ✅ Gemini trả...` và mapping G–K giữ nguyên.)

## 6. src/discord/discord.module.ts — đổi path import
```typescript
import { GeminiModule } from '../shared/gemini/gemini.module';
```
(Phần `imports: [GoogleSheetsModule, GeminiModule]` giữ nguyên — QuizModule thêm ở phase 03.)

## 7. Encapsulation / wiring notes
- `src/shared/gemini/` generic: chỉ phụ thuộc `ConfigService`. KHÔNG import gì từ discord/quiz.
- Prompt + schema hóa đơn thuộc **domain discord** → nằm ở `src/discord/`.
- Xóa sạch `src/gemini/` (3 file) — không để lại file mồ côi.

## 8. Acceptance criteria
- [ ] `src/gemini/` không còn tồn tại; `src/shared/gemini/` có service+module.
- [ ] `npm run typecheck` pass.
- [ ] `npm run build` pass; `dist/shared/gemini/gemini.service.js` tồn tại, `dist/gemini/` không còn.
- [ ] `npm run start:dev` boot OK (log "Discord logged in", "Connected to sheet").
- [ ] Regression task 2: gửi ảnh hóa đơn → vẫn điền cột G–K (cần GEMINI_API_KEY thật).

## 9. Out of scope (phase này)
- QuizService / slash command (phase 02, 03).
- Thêm dependency mới (mammoth ở phase 02).

## 10. Commit message dự kiến
```
refactor(gemini): move to shared + generic extractStructured API

Chuyển GeminiService sang src/shared/gemini/, tổng quát hóa thành
extractStructured(schema, parts) + helper textPart/imagePart/mediaPart;
cache LLM theo model. Schema + prompt hóa đơn về src/discord/ (domain).
Task 2 gọi qua API generic, hành vi không đổi. Dọn src/gemini/.
```
