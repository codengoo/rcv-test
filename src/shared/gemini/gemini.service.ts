import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, MessageContentComplex } from '@langchain/core/messages';
import { z } from 'zod';

// const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
// const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_MODEL = 'gemini-3.5-flash';
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
    // maxOutputTokens cao: đề thi giải đầy đủ + lời giải → JSON rất dài,
    // mặc định thấp khiến output bị cắt giữa chừng (Unterminated string).
    const llm = new ChatGoogleGenerativeAI({
      model,
      apiKey,
      temperature: 0,
      maxOutputTokens: 65536,
    });
    this.llmCache.set(model, llm);
    return llm;
  }

  // ---- Helpers dựng content part ----
  textPart(text: string): AiPart {
    return { type: 'text', text };
  }

  imagePart(base64: string, mimeType: string): AiPart {
    return {
      type: 'image_url',
      image_url: `data:${mimeType};base64,${base64}`,
    };
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
    const name = opts?.name ?? 'output';
    // cast any: tránh deep type instantiation của withStructuredOutput + zod.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (this.getLlm(model) as any).withStructuredOutput(schema, {
      name,
    });
    const message = new HumanMessage({ content: parts });

    this.logger.log(
      `Gọi ${model} structured "${name}" (${parts.length} part)...`,
    );
    return this.withRetry(
      () => structured.invoke([message]) as Promise<T>,
      'extractStructured',
    );
  }

  /**
   * Gọi model với content parts, trả về TEXT thường (không ép schema). Dùng khi
   * cần output dạng tự do như Markdown — tránh giới hạn/parse của structured.
   */
  async generateText(
    parts: AiPart[],
    opts?: { model?: string },
  ): Promise<string> {
    const model = opts?.model ?? DEFAULT_MODEL;
    const llm = this.getLlm(model);
    const message = new HumanMessage({ content: parts });

    this.logger.log(`Gọi ${model} text (${parts.length} part)...`);
    return this.withRetry(async () => {
      const result = await llm.invoke([message]);
      const content = result.content;
      if (typeof content === 'string') return content;
      // content phức hợp → ghép các phần text lại.
      return content
        .map((c) => (typeof c === 'object' && 'text' in c ? c.text : ''))
        .join('');
    }, 'generateText');
  }

  /** Bọc retry ngắn + log dùng chung cho các lời gọi model. */
  private async withRetry<R>(fn: () => Promise<R>, label: string): Promise<R> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fn();
        this.logger.log(`${label} phản hồi OK (lần ${attempt})`);
        return result;
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt === MAX_RETRIES) {
          this.logger.error(`${label} fail sau ${MAX_RETRIES} lần: ${msg}`);
          throw err;
        }
        this.logger.warn(`${label} lỗi (lần ${attempt}), retry: ${msg}`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    throw new Error(`${label}: unreachable`);
  }
}
