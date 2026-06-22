# Phase 03 — Discord Listener (fixed channel → dedup → SheetsService)

**Goal:** Sau phase này tồn tại `DiscordModule` với `DiscordService` tạo discord.js client, login bằng `DISCORD_BOT_TOKEN`, lắng nghe `messageCreate` chỉ trên `DISCORD_CHANNEL_ID`, bỏ qua bot message, dedup theo messageId (in-memory cap), và gọi `SheetsService.appendRow`. App chạy end-to-end: gửi tin trong channel cố định → 1 row mới trong sheet.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/discord/discord.service.ts | CREATE |
| src/discord/discord.module.ts | CREATE |
| src/app.module.ts | MODIFY |

## 2. Nội dung file

### src/discord/discord.service.ts
```typescript
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Events, GatewayIntentBits, Message } from 'discord.js';
import { SheetsService } from '../sheets/sheets.service';

const SEEN_CAP = 5000;

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);
  private readonly client: Client;
  private readonly channelId: string;
  private readonly seen = new Set<string>();
  private readonly seenQueue: string[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly sheets: SheetsService,
  ) {
    this.channelId = this.config.getOrThrow<string>('DISCORD_CHANNEL_ID');
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async onModuleInit() {
    this.client.once(Events.ClientReady, (c) => {
      this.logger.log(`Discord logged in as ${c.user.tag}, watching channel ${this.channelId}`);
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });

    const token = this.config.getOrThrow<string>('DISCORD_BOT_TOKEN');
    await this.client.login(token);
  }

  async onModuleDestroy() {
    await this.client.destroy();
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.channelId !== this.channelId) return;
    if (message.author.bot) return;
    if (this.isDuplicate(message.id)) return;
    this.remember(message.id);

    try {
      await this.sheets.appendRow({
        timestamp: message.createdAt.toISOString(),
        author: message.author.tag,
        authorId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
        content: message.content ?? '',
      });
      this.logger.debug(`Logged message ${message.id} to sheet`);
    } catch (err) {
      // appendRow đã retry; tới đây là fail hẳn — log, không crash.
      this.logger.error(`Không ghi được message ${message.id}: ${(err as Error).message}`);
    }
  }

  private isDuplicate(id: string): boolean {
    return this.seen.has(id);
  }

  private remember(id: string): void {
    this.seen.add(id);
    this.seenQueue.push(id);
    if (this.seenQueue.length > SEEN_CAP) {
      const evicted = this.seenQueue.shift();
      if (evicted) this.seen.delete(evicted);
    }
  }
}
```

### src/discord/discord.module.ts
```typescript
import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { SheetsModule } from '../sheets/sheets.module';

@Module({
  imports: [SheetsModule],
  providers: [DiscordService],
})
export class DiscordModule {}
```

### src/app.module.ts (MODIFY)
Thêm `DiscordModule` vào imports:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { SheetsModule } from './sheets/sheets.module';
import { DiscordModule } from './discord/discord.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    SheetsModule,
    DiscordModule,
  ],
})
export class AppModule {}
```

## 3. Encapsulation / wiring notes
- `DiscordModule` import `SheetsModule` (đã `exports: [SheetsService]`) — DiscordService inject `SheetsService` qua DI, KHÔNG `new` thủ công.
- DiscordService chỉ gọi `sheets.appendRow(...)`. Không biết gì về google-spreadsheet.
- Dedup là in-memory (Set + FIFO queue cap 5000). Reset khi restart — đã ghi nhận ở plan §9 Risks.
- Intents bắt buộc `MessageContent` để đọc `message.content`; user phải bật "Message Content Intent" trong Discord Developer Portal (README ghi rõ).
- `onModuleDestroy` destroy client để shutdown sạch.

## 4. Acceptance criteria
- [ ] `npm run typecheck` pass.
- [ ] Với `.env` có token thật + channel id thật + sheet đã share service account: `npm run start:dev` → log `Discord logged in as <tag>, watching channel <id>`.
- [ ] Gửi 1 tin nhắn (tài khoản người thật) trong channel cố định → xuất hiện đúng 1 row mới trong worksheet đầu tiên với đủ 6 cột đúng giá trị.
- [ ] Gửi tin ở channel KHÁC → không có row mới.
- [ ] Tin nhắn từ bot khác → không có row mới.
- [ ] Tắt server (Ctrl+C) → thoát sạch, không treo (client.destroy chạy).

## 5. Out of scope (cho phase này)
- Không phản hồi lại Discord (no reply/react).
- Không slash command.
- Không persistent dedup.

## 6. Commit message dự kiến
```
feat(discord): log fixed-channel messages to Google Sheets

DiscordModule/DiscordService: discord.js v14 client login bằng bot token,
lắng nghe messageCreate chỉ trên DISCORD_CHANNEL_ID, bỏ qua bot message,
dedup messageId in-memory (cap 5000 FIFO), gọi SheetsService.appendRow.
Intents Guilds + GuildMessages + MessageContent. Wire DiscordModule vào AppModule.
```
