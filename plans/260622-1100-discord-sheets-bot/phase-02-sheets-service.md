# Phase 02 — Sheets Service (Service Account + append + retry)

**Goal:** Sau phase này tồn tại `SheetsModule` export `SheetsService`. `SheetsService` xác thực Google Sheets bằng service account JWT (lazy, lần dùng đầu), và có method `appendRow(row: MessageRow)` append đúng thứ tự cột A→F với retry exponential backoff. Module được import vào `AppModule` nhưng chưa có ai gọi (sẽ test boot không crash).

## 1. Files chạm vào
| File | Action |
|---|---|
| src/sheets/message-row.interface.ts | CREATE |
| src/sheets/sheets.service.ts | CREATE |
| src/sheets/sheets.module.ts | CREATE |
| src/app.module.ts | MODIFY |

## 2. Nội dung file

### src/sheets/message-row.interface.ts
```typescript
// Một row append vào sheet, đúng thứ tự cột A→F
export interface MessageRow {
  timestamp: string;
  author: string;
  authorId: string;
  channelId: string;
  messageId: string;
  content: string;
}
```

### src/sheets/sheets.service.ts
```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { MessageRow } from './message-row.interface';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const HEADER = ['timestamp', 'author', 'authorId', 'channelId', 'messageId', 'content'];
const MAX_RETRIES = 3;

@Injectable()
export class SheetsService implements OnModuleInit {
  private readonly logger = new Logger(SheetsService.name);
  private doc!: GoogleSpreadsheet;
  private sheet!: GoogleSpreadsheetWorksheet;
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    // Kết nối lazy nhưng warm sẵn khi boot; nếu fail chỉ log, không chặn app.
    try {
      await this.init();
      this.logger.log(`Connected to sheet "${this.doc.title}"`);
    } catch (err) {
      this.logger.error(
        `Không kết nối được Google Sheet khi boot (sẽ thử lại khi append): ${(err as Error).message}`,
      );
    }
  }

  private async init() {
    if (this.ready) return;
    // Đọc credentials từ file service-account.json (mặc định ./service-account.json),
    // KHÔNG để private key trong env.
    const keyFile = resolve(
      this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_FILE') ?? 'service-account.json',
    );
    const creds = JSON.parse(readFileSync(keyFile, 'utf8'));
    const sheetId = this.config.getOrThrow<string>('GOOGLE_SHEET_ID');

    const jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
    this.doc = new GoogleSpreadsheet(sheetId, jwt);
    await this.doc.loadInfo();
    this.sheet = this.doc.sheetsByIndex[0];
    this.ready = true;
  }

  async appendRow(row: MessageRow): Promise<void> {
    const values = [
      row.timestamp,
      row.author,
      row.authorId,
      row.channelId,
      row.messageId,
      row.content,
    ];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.init();
        // header: true để map theo HEADER nếu sheet đã có header; fallback raw values.
        await this.sheet.addRow(values, { raw: true, insert: true });
        return;
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt === MAX_RETRIES) {
          this.logger.error(`appendRow fail sau ${MAX_RETRIES} lần (messageId=${row.messageId}): ${msg}`);
          throw err;
        }
        const backoff = 500 * 2 ** (attempt - 1);
        this.logger.warn(`appendRow lỗi (lần ${attempt}), retry sau ${backoff}ms: ${msg}`);
        // reset ready để init lại nếu lỗi do auth/expired
        this.ready = false;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  // Dùng để tham chiếu thứ tự cột mong đợi (header user nên đặt khớp).
  static expectedHeader(): string[] {
    return [...HEADER];
  }
}
```

### src/sheets/sheets.module.ts
```typescript
import { Module } from '@nestjs/common';
import { SheetsService } from './sheets.service';

@Module({
  providers: [SheetsService],
  exports: [SheetsService],
})
export class SheetsModule {}
```

### src/app.module.ts (MODIFY)
Thêm `SheetsModule` vào imports:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { SheetsModule } from './sheets/sheets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    SheetsModule,
  ],
})
export class AppModule {}
```

## 3. Encapsulation / wiring notes
- `SheetsService` chỉ expose `appendRow` (+ static `expectedHeader`). DiscordService ở phase 03 gọi qua method này, KHÔNG truy cập `this.sheet` trực tiếp.
- `SheetsModule` phải `exports: [SheetsService]` để DiscordModule import dùng.
- `addRow(values, { insert: true })` dùng `append` semantics của Sheets API (ghi vào hàng trống cuối). `raw: true` để content không bị Google diễn giải thành formula/number.
- Private key đọc từ env phải replace `\\n` → `\n`.
- Lỗi khi boot chỉ log, không throw (app vẫn sống để Discord listener chạy; append sẽ tự init lại).

## 4. Acceptance criteria
- [ ] `npm run typecheck` pass.
- [ ] `npm run start:dev` boot: nếu `.env` có service account thật + sheet đã share → log `Connected to sheet "<title>"`. Nếu credentials giả → log warning "Không kết nối được Google Sheet khi boot" nhưng app KHÔNG crash.
- [ ] (Manual, nếu có credentials thật) Tạm thêm 1 dòng gọi `appendRow` trong một script tạm hoặc REPL → xuất hiện đúng 1 row mới ở worksheet đầu tiên, đúng thứ tự cột. (Xóa code tạm sau khi verify.)

## 5. Out of scope (cho phase này)
- Không có Discord client / listener.
- Không tự tạo header row trong sheet (user tự đặt; `expectedHeader` chỉ để tham chiếu).
- Không dedup (nằm ở DiscordService phase 03).

## 6. Commit message dự kiến
```
feat(sheets): add SheetsService with service-account auth and retrying append

SheetsModule export SheetsService: xác thực Google Sheets bằng JWT service
account (google-spreadsheet + google-auth-library), append MessageRow theo
thứ tự cột A→F với exponential backoff retry (3 lần). Lỗi kết nối lúc boot chỉ
log, không chặn app. Private key xử lý \n. Import SheetsModule vào AppModule.
```
