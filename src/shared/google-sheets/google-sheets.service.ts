import { existsSync } from 'fs';
import { resolve } from 'path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const DEFAULT_KEY_FILE = 'service-account.json';
const MAX_RETRIES = 3;

export type CellValue = string | number | boolean | null;

/**
 * Generic Google Sheets client (googleapis). Không chứa logic domain nào —
 * chỉ thao tác theo spreadsheetId + range. Dùng chung cho mọi module.
 */
@Injectable()
export class GoogleSheetsService implements OnModuleInit {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private client?: sheets_v4.Sheets;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Warm sẵn auth; lỗi chỉ log, không chặn app (sẽ thử lại khi gọi API).
    try {
      this.getClient();
      this.logger.log('Google Sheets client initialized');
    } catch (err) {
      this.logger.error(
        `Khởi tạo Google Sheets client lỗi: ${(err as Error).message}`,
      );
    }
  }

  private getClient(): sheets_v4.Sheets {
    if (this.client) return this.client;
    const keyFile = resolve(
      this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_FILE') ?? DEFAULT_KEY_FILE,
    );
    if (!existsSync(keyFile)) {
      throw new Error(`Không tìm thấy service account file "${keyFile}"`);
    }
    const auth = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
    this.client = google.sheets({ version: 'v4', auth });
    return this.client;
  }

  /** Tiêu đề worksheet đầu tiên — cũng dùng để verify kết nối tới spreadsheet. */
  async getFirstSheetTitle(spreadsheetId: string): Promise<string> {
    const res = await this.getClient().spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
    const title = res.data.sheets?.[0]?.properties?.title;
    if (!title) {
      throw new Error(`Spreadsheet ${spreadsheetId} không có worksheet nào`);
    }
    return title;
  }

  /**
   * Append 1 row vào range (vd tên sheet "Sheet1" hoặc "Sheet1!A:F").
   * Có retry exponential backoff; reset client nếu lỗi auth.
   */
  async appendRow(
    spreadsheetId: string,
    range: string,
    values: CellValue[],
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.getClient().spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [values] },
        });
        return;
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt === MAX_RETRIES) {
          this.logger.error(`appendRow fail sau ${MAX_RETRIES} lần: ${msg}`);
          throw err;
        }
        const backoff = 500 * 2 ** (attempt - 1);
        this.logger.warn(
          `appendRow lỗi (lần ${attempt}), retry sau ${backoff}ms: ${msg}`,
        );
        this.client = undefined; // re-init nếu lỗi do auth/expired
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
}
