import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import {
  HumanMessage,
  type HumanMessageFields,
  type MessageContentComplex,
} from '@langchain/core/messages';
import {
  GoogleAIFileManager,
  FileState,
  type FileMetadataResponse,
} from '@google/generative-ai/server';
import { z } from 'zod';

// Chuỗi model fallback (theo thứ tự ưu tiên): flash trước (nhanh/rẻ), hết key
// của flash mới sang pro. Với mỗi model, lần lượt thử từng API key.
const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3.1-pro'];
// File API: chờ file chuyển ACTIVE (PDF/ảnh có thể PROCESSING vài giây).
const FILE_ACTIVE_TIMEOUT_MS = 60_000;
const FILE_POLL_INTERVAL_MS = 1_000;
// Ngưỡng mặc định (mode 'auto'): file lớn hơn thì upload qua File API thay vì
// nhúng base64 inline (tránh request nặng / chạm trần ~20MB inline của Gemini).
const UPLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2MB

/** 1 phần nội dung gửi cho model (text / ảnh / media như PDF). */
export type AiPart = MessageContentComplex;

/**
 * Quyết định cách đưa file vào model:
 *  - 'auto'   (mặc định): upload qua File API nếu > 2MB, còn lại nhúng inline.
 *  - 'always': luôn upload qua File API.
 *  - 'never' : luôn nhúng base64 inline.
 */
export type UploadMode = 'auto' | 'always' | 'never';

/** File đã upload qua Gemini File API — đủ thông tin để tham chiếu + xóa. */
interface UploadedFile {
  /** Resource name dạng "files/xxx" — dùng để xóa. */
  name: string;
  /** fileUri tham chiếu trong content part. */
  uri: string;
  mimeType: string;
}

/**
 * Part "file" do filePart() tạo — chưa quyết định inline/upload. GeminiService
 * giải quyết (resolveParts) ngay trước khi gọi model, rồi tự dọn asset sau đó.
 */
interface PendingFilePart {
  __geminiFile: true;
  data: Buffer;
  mimeType: string;
  displayName?: string;
}

/**
 * Generic Gemini client (LangChain). Không chứa logic domain — nhận schema +
 * các content part, trả structured output đã validate. Dùng chung mọi module.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly llmCache = new Map<string, ChatGoogleGenerativeAI>();
  private readonly fileManagerCache = new Map<string, GoogleAIFileManager>();
  private apiKeys?: string[];

  constructor(private readonly config: ConfigService) {}

  /**
   * Danh sách API key (GEMINI_API_KEY phân tách bằng dấu phẩy/khoảng trắng/xuống
   * dòng). Cache lại sau lần đọc đầu. Ném lỗi nếu rỗng.
   */
  private getApiKeys(): string[] {
    if (this.apiKeys) return this.apiKeys;
    const raw = this.config.getOrThrow<string>('GEMINI_API_KEY');
    const keys = raw
      .split(/[\s,]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (!keys.length) throw new Error('GEMINI_API_KEY rỗng (cần ít nhất 1 key)');
    this.apiKeys = keys;
    return keys;
  }

  /** FileManager riêng cho từng API key (file upload bị gắn với key đã upload). */
  private getFileManager(apiKey: string): GoogleAIFileManager {
    let fm = this.fileManagerCache.get(apiKey);
    if (!fm) {
      fm = new GoogleAIFileManager(apiKey);
      this.fileManagerCache.set(apiKey, fm);
    }
    return fm;
  }

  /** Lỗi quota/rate-limit (429 / RESOURCE_EXHAUSTED) → nên xoay sang key khác. */
  private isQuotaError(err: unknown): boolean {
    const msg = (err as Error)?.message ?? '';
    return /\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg);
  }

  /**
   * Upload 1 file (ảnh/PDF...) qua Gemini File API thay vì nhúng base64 inline.
   * Chờ tới khi file ACTIVE (ném lỗi nếu FAILED hoặc quá hạn). Nội bộ: việc dọn
   * asset do resolveParts/runWithRotation đảm nhiệm sau khi gọi model.
   */
  private async uploadFile(
    apiKey: string,
    data: Buffer,
    mimeType: string,
    displayName?: string,
  ): Promise<UploadedFile> {
    const fm = this.getFileManager(apiKey);
    const { file } = await fm.uploadFile(data, { mimeType, displayName });
    this.logger.log(
      `Upload file ${file.name} (${file.sizeBytes} bytes, ${mimeType}), state=${file.state}`,
    );
    const active = await this.waitActive(apiKey, file);
    return { name: active.name, uri: active.uri, mimeType: active.mimeType };
  }

  /** Poll getFile cho tới khi rời trạng thái PROCESSING; ném lỗi nếu FAILED. */
  private async waitActive(
    apiKey: string,
    file: FileMetadataResponse,
  ): Promise<FileMetadataResponse> {
    const fm = this.getFileManager(apiKey);
    let meta = file;
    let waited = 0;
    while (meta.state === FileState.PROCESSING) {
      if (waited >= FILE_ACTIVE_TIMEOUT_MS) {
        throw new Error(
          `File ${meta.name} vẫn PROCESSING sau ${FILE_ACTIVE_TIMEOUT_MS}ms`,
        );
      }
      await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
      waited += FILE_POLL_INTERVAL_MS;
      meta = await fm.getFile(meta.name);
    }
    if (meta.state === FileState.FAILED) {
      throw new Error(
        `File ${meta.name} xử lý FAILED: ${meta.error?.message ?? 'unknown'}`,
      );
    }
    return meta;
  }

  /** Xóa 1 file đã upload (best-effort: chỉ log warn nếu lỗi, không ném). */
  private async deleteFile(apiKey: string, name: string): Promise<void> {
    try {
      await this.getFileManager(apiKey).deleteFile(name);
      this.logger.log(`Xóa file ${name}`);
    } catch (err) {
      this.logger.warn(`Không xóa được file ${name}: ${(err as Error).message}`);
    }
  }

  /** Xóa nhiều file song song (best-effort). */
  private async deleteFiles(apiKey: string, names: string[]): Promise<void> {
    await Promise.all(names.map((n) => this.deleteFile(apiKey, n)));
  }

  /**
   * Khai báo 1 file (ảnh/PDF...) để gửi cho model. CHƯA upload — GeminiService
   * tự quyết định inline hay upload File API lúc gọi model (theo opts.upload),
   * và tự xóa asset sau đó. Truyền data dạng Buffer.
   */
  filePart(data: Buffer, mimeType: string, displayName?: string): AiPart {
    const part: PendingFilePart = {
      __geminiFile: true,
      data,
      mimeType,
      displayName,
    };
    return part as unknown as AiPart;
  }

  /**
   * Giải quyết các PendingFilePart trong danh sách part trước khi gọi model:
   * file lớn → upload File API (gom name vào uploadedNames để dọn sau), file
   * nhỏ → nhúng base64 inline. Part khác (text...) giữ nguyên.
   */
  private async resolveParts(
    apiKey: string,
    parts: AiPart[],
    mode: UploadMode,
    uploadedNames: string[],
  ): Promise<AiPart[]> {
    const out: AiPart[] = [];
    for (const part of parts) {
      const file = part as unknown as Partial<PendingFilePart>;
      if (!file?.__geminiFile) {
        out.push(part);
        continue;
      }
      const { data, mimeType, displayName } = file as PendingFilePart;
      const shouldUpload =
        mode === 'always' ||
        (mode === 'auto' && data.length > UPLOAD_THRESHOLD_BYTES);
      if (shouldUpload) {
        const up = await this.uploadFile(apiKey, data, mimeType, displayName);
        uploadedNames.push(up.name);
        out.push({
          type: 'media',
          mimeType: up.mimeType,
          fileUri: up.uri,
        } as unknown as AiPart);
      } else {
        out.push({
          type: 'media',
          mimeType,
          data: data.toString('base64'),
        } as unknown as AiPart);
      }
    }
    return out;
  }

  private getLlm(
    model: string,
    apiKey: string,
    thinkingBudget?: number,
  ): ChatGoogleGenerativeAI {
    const key = `${model}:${thinkingBudget ?? 'default'}:${apiKey}`;
    const cached = this.llmCache.get(key);
    if (cached) return cached;
    // maxOutputTokens cao: đề thi giải đầy đủ + lời giải → JSON rất dài,
    // mặc định thấp khiến output bị cắt giữa chừng (Unterminated string).
    // thinkingBudget=0 → tắt "thinking" để giảm mạnh latency (caller tự chọn).
    const llm = new ChatGoogleGenerativeAI({
      model,
      apiKey,
      temperature: 0,
      maxOutputTokens: 65536,
      ...(thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget } }
        : {}),
    });
    this.llmCache.set(key, llm);
    return llm;
  }

  /**
   * Danh sách "attempt" theo thứ tự fallback: với MỖI model (flash trước, pro
   * sau — hoặc chỉ model do caller chỉ định), lần lượt thử TỪNG api key. Hết key
   * của model này mới sang model kế tiếp.
   */
  private buildAttempts(
    modelOverride?: string,
  ): { model: string; apiKey: string; keyIndex: number }[] {
    const models = modelOverride ? [modelOverride] : DEFAULT_MODELS;
    const keys = this.getApiKeys();
    const attempts: { model: string; apiKey: string; keyIndex: number }[] = [];
    for (const model of models) {
      keys.forEach((apiKey, keyIndex) =>
        attempts.push({ model, apiKey, keyIndex }),
      );
    }
    return attempts;
  }

  /**
   * Lõi xoay key + model: lần lượt thử từng (model, key) theo buildAttempts. Mỗi
   * attempt tự resolve part bằng KEY của attempt đó (file upload phải cùng key
   * với lời gọi model) và LUÔN dọn asset ở finally. Lỗi → log + thử attempt kế;
   * hết attempt → ném lỗi cuối cùng.
   */
  private async runWithRotation<R>(
    parts: AiPart[],
    mode: UploadMode | undefined,
    modelOverride: string | undefined,
    thinkingBudget: number | undefined,
    label: string,
    run: (llm: ChatGoogleGenerativeAI, resolved: AiPart[]) => Promise<R>,
  ): Promise<R> {
    const attempts = this.buildAttempts(modelOverride);
    const total = attempts.length;
    let lastErr: unknown;
    for (let i = 0; i < total; i++) {
      const { model, apiKey, keyIndex } = attempts[i];
      const uploadedNames: string[] = [];
      try {
        const resolved = await this.resolveParts(
          apiKey,
          parts,
          mode ?? 'auto',
          uploadedNames,
        );
        const llm = this.getLlm(model, apiKey, thinkingBudget);
        this.logger.log(
          `${label}: ${model} key #${keyIndex + 1} (attempt ${i + 1}/${total}, ${resolved.length} part)...`,
        );
        const result = await run(llm, resolved);
        this.logger.log(`${label}: OK với ${model} key #${keyIndex + 1}`);
        return result;
      } catch (err) {
        lastErr = err;
        const quota = this.isQuotaError(err) ? ' (quota/rate-limit)' : '';
        this.logger.warn(
          `${label}: lỗi ${model} key #${keyIndex + 1}${quota}: ${(err as Error).message}`,
        );
      } finally {
        if (uploadedNames.length) await this.deleteFiles(apiKey, uploadedNames);
      }
    }
    this.logger.error(`${label}: thất bại sau ${total} attempt (mọi key/model).`);
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`${label}: tất cả attempt đều fail`);
  }

  /**
   * Cast các AiPart (dạng MessageContentComplex "cũ") sang kiểu content mới của
   * @langchain/core v1. Runtime google-genai vẫn nhận các part dạng cũ; chỉ
   * phần type bị siết lại nên cần cast tập trung tại đây.
   */
  private toContent(parts: AiPart[]): HumanMessageFields['content'] {
    return parts as unknown as HumanMessageFields['content'];
  }

  // ---- Helpers dựng content part ----
  textPart(text: string): AiPart {
    return { type: 'text', text };
  }

  /**
   * Gọi model với content parts, ép structured output theo zod schema. Tự xoay
   * key + model (flash→pro) khi lỗi; ném lỗi nếu mọi attempt fail (caller xử lý).
   */
  async extractStructured<T>(
    schema: z.ZodType<T>,
    parts: AiPart[],
    opts?: {
      model?: string;
      name?: string;
      upload?: UploadMode;
      thinkingBudget?: number;
    },
  ): Promise<T> {
    const name = opts?.name ?? 'output';
    return this.runWithRotation(
      parts,
      opts?.upload,
      opts?.model,
      opts?.thinkingBudget,
      `extractStructured "${name}"`,
      (llm, resolved) => {
        // cast any: tránh deep type instantiation của withStructuredOutput + zod.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const structured = (llm as any).withStructuredOutput(schema, { name });
        const message = new HumanMessage({ content: this.toContent(resolved) });
        return structured.invoke([message]) as Promise<T>;
      },
    );
  }

  /**
   * Gọi model với content parts, trả về TEXT thường (không ép schema). Dùng khi
   * cần output dạng tự do như Markdown — tránh giới hạn/parse của structured.
   */
  async generateText(
    parts: AiPart[],
    opts?: { model?: string; upload?: UploadMode; thinkingBudget?: number },
  ): Promise<string> {
    return this.runWithRotation(
      parts,
      opts?.upload,
      opts?.model,
      opts?.thinkingBudget,
      'generateText',
      async (llm, resolved) => {
        const message = new HumanMessage({ content: this.toContent(resolved) });
        const result = await llm.invoke([message]);
        const content = result.content;
        if (typeof content === 'string') return content;
        // content phức hợp → ghép các phần text lại.
        return content
          .map((c) => (typeof c === 'object' && 'text' in c ? c.text : ''))
          .join('');
      },
    );
  }
}
