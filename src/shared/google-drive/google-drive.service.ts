import { existsSync } from 'fs';
import { resolve } from 'path';
import { Readable } from 'stream';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, drive_v3 } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const DEFAULT_KEY_FILE = 'service-account.json';
const MAX_RETRIES = 3;

/** Kết quả upload 1 file lên Drive. */
export interface DriveUpload {
  id: string;
  link: string; // webViewLink (xem được nếu đã chia sẻ)
}

/**
 * Generic Google Drive client (googleapis) — dùng chung service account với
 * Sheets. Upload buffer vào 1 folder và trả link xem. Không chứa logic domain.
 */
@Injectable()
export class GoogleDriveService implements OnModuleInit {
  private readonly logger = new Logger(GoogleDriveService.name);
  private client?: drive_v3.Drive;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    try {
      this.getClient();
      this.logger.log('Google Drive client initialized');
    } catch (err) {
      this.logger.error(
        `Khởi tạo Google Drive client lỗi: ${(err as Error).message}`,
      );
    }
  }

  private getClient(): drive_v3.Drive {
    if (this.client) return this.client;
    const keyFile = resolve(
      this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_FILE') ?? DEFAULT_KEY_FILE,
    );
    if (!existsSync(keyFile)) {
      throw new Error(`Không tìm thấy service account file "${keyFile}"`);
    }
    const auth = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
    this.client = google.drive({ version: 'v3', auth });
    return this.client;
  }

  /**
   * Upload 1 file (buffer) vào folder Drive, đặt quyền "ai có link cũng xem"
   * rồi trả về id + webViewLink. Có retry; reset client nếu lỗi auth.
   */
  async uploadFile(
    folderId: string,
    name: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<DriveUpload> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const drive = this.getClient();
        const created = await drive.files.create({
          requestBody: { name, parents: [folderId] },
          media: { mimeType, body: Readable.from(buffer) },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        });
        const id = created.data.id;
        if (!id) throw new Error('Drive không trả về file id');

        // Chia sẻ công khai (xem) để link dùng được từ Sheet.
        await drive.permissions.create({
          fileId: id,
          requestBody: { role: 'reader', type: 'anyone' },
          supportsAllDrives: true,
        });

        const link =
          created.data.webViewLink ??
          `https://drive.google.com/file/d/${id}/view`;
        return { id, link };
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt === MAX_RETRIES) {
          this.logger.error(`uploadFile fail sau ${MAX_RETRIES} lần: ${msg}`);
          throw err;
        }
        const backoff = 500 * 2 ** (attempt - 1);
        this.logger.warn(
          `uploadFile lỗi (lần ${attempt}), retry sau ${backoff}ms: ${msg}`,
        );
        this.client = undefined; // re-init nếu lỗi do auth/expired
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw new Error('uploadFile: unreachable');
  }
}
