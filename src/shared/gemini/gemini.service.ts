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

// const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
// const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_MODEL = 'gemini-3.5-flash';
const MAX_RETRIES = 2;
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
  private fileManager?: GoogleAIFileManager;

  constructor(private readonly config: ConfigService) {}

  private getFileManager(): GoogleAIFileManager {
    if (!this.fileManager) {
      const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
      this.fileManager = new GoogleAIFileManager(apiKey);
    }
    return this.fileManager;
  }

  /**
   * Upload 1 file (ảnh/PDF...) qua Gemini File API thay vì nhúng base64 inline.
   * Chờ tới khi file ACTIVE (ném lỗi nếu FAILED hoặc quá hạn). Nội bộ: việc dọn
   * asset do resolveParts/runWithParts đảm nhiệm sau khi gọi model.
   */
  private async uploadFile(
    data: Buffer,
    mimeType: string,
    displayName?: string,
  ): Promise<UploadedFile> {
    const fm = this.getFileManager();
    const { file } = await fm.uploadFile(data, { mimeType, displayName });
    this.logger.log(
      `Upload file ${file.name} (${file.sizeBytes} bytes, ${mimeType}), state=${file.state}`,
    );
    const active = await this.waitActive(file);
    return { name: active.name, uri: active.uri, mimeType: active.mimeType };
  }

  /** Poll getFile cho tới khi rời trạng thái PROCESSING; ném lỗi nếu FAILED. */
  private async waitActive(
    file: FileMetadataResponse,
  ): Promise<FileMetadataResponse> {
    const fm = this.getFileManager();
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
  private async deleteFile(name: string): Promise<void> {
    try {
      await this.getFileManager().deleteFile(name);
      this.logger.log(`Xóa file ${name}`);
    } catch (err) {
      this.logger.warn(`Không xóa được file ${name}: ${(err as Error).message}`);
    }
  }

  /** Xóa nhiều file song song (best-effort). */
  private async deleteFiles(names: string[]): Promise<void> {
    await Promise.all(names.map((n) => this.deleteFile(n)));
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
        const up = await this.uploadFile(data, mimeType, displayName);
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

  /**
   * Giải quyết file part → chạy callback với part đã resolve → LUÔN dọn các file
   * đã upload ở finally (thành công hay lỗi đều xóa asset).
   */
  private async runWithParts<R>(
    parts: AiPart[],
    mode: UploadMode | undefined,
    run: (resolved: AiPart[]) => Promise<R>,
  ): Promise<R> {
    const uploadedNames: string[] = [];
    try {
      const resolved = await this.resolveParts(
        parts,
        mode ?? 'auto',
        uploadedNames,
      );
      return await run(resolved);
    } finally {
      if (uploadedNames.length) await this.deleteFiles(uploadedNames);
    }
  }

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
   * Gọi model với content parts, ép structured output theo zod schema.
   * Có retry ngắn; ném lỗi nếu vẫn fail sau MAX_RETRIES (caller tự xử lý).
   */
  async extractStructured<T>(
    schema: z.ZodType<T>,
    parts: AiPart[],
    opts?: { model?: string; name?: string; upload?: UploadMode },
  ): Promise<T> {
    const model = opts?.model ?? DEFAULT_MODEL;
    const name = opts?.name ?? 'output';
    return this.runWithParts(parts, opts?.upload, async (resolved) => {
      // cast any: tránh deep type instantiation của withStructuredOutput + zod.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const structured = (this.getLlm(model) as any).withStructuredOutput(
        schema,
        { name },
      );
      const message = new HumanMessage({ content: this.toContent(resolved) });

      this.logger.log(
        `Gọi ${model} structured "${name}" (${resolved.length} part)...`,
      );
      return this.withRetry(
        () => structured.invoke([message]) as Promise<T>,
        'extractStructured',
      );
    });
  }

  /**
   * Gọi model với content parts, trả về TEXT thường (không ép schema). Dùng khi
   * cần output dạng tự do như Markdown — tránh giới hạn/parse của structured.
   */
  async generateText(
    parts: AiPart[],
    opts?: { model?: string; upload?: UploadMode },
  ): Promise<string> {
    const model = opts?.model ?? DEFAULT_MODEL;
    return this.runWithParts(parts, opts?.upload, async (resolved) => {
      const llm = this.getLlm(model);
      const message = new HumanMessage({ content: this.toContent(resolved) });

      this.logger.log(`Gọi ${model} text (${resolved.length} part)...`);
      return this.withRetry(async () => {
        const result = await llm.invoke([message]);
        const content = result.content;
        if (typeof content === 'string') return content;
        // content phức hợp → ghép các phần text lại.
        return content
          .map((c) => (typeof c === 'object' && 'text' in c ? c.text : ''))
          .join('');
      }, 'generateText');
    });
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
