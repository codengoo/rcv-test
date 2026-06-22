# Phase 03 — Slash command /add-quiz + embed reply

**Goal:** Bot đăng ký slash command `/add-quiz` (option attachment `file`) theo guild `DISCORD_GUILD_ID` lúc ready, xử lý interaction: tải file → `QuizService.solveAndSave` → reply **embed** (tên đề + số câu + tên file input + đường dẫn lưu). Sai định dạng / lỗi → embed lỗi (ephemeral).

## 1. Files chạm vào
| File | Action |
|---|---|
| src/config/env.validation.ts | MODIFY (+`DISCORD_GUILD_ID`) |
| .env.example | MODIFY (+`DISCORD_GUILD_ID`) |
| .env | MODIFY (+`DISCORD_GUILD_ID` thật/placeholder) |
| src/discord/discord.module.ts | MODIFY (import QuizModule) |
| src/discord/discord.service.ts | MODIFY (inject QuizService, register command, handle interaction) |
| README.md | MODIFY (mục /add-quiz + scope command) |

## 2. env.validation.ts — thêm
```typescript
  @IsString()
  DISCORD_GUILD_ID!: string;
```

## 3. .env.example / .env — thêm
`.env.example`:
```
# ID server (guild) để đăng ký slash command /add-quiz (bật Developer Mode → chuột phải server → Copy Server ID)
DISCORD_GUILD_ID=123456789012345678
```
`.env`: thêm `DISCORD_GUILD_ID=<guild id thật>` (nếu user chưa cấp → placeholder + nhắc thay).

## 4. src/discord/discord.module.ts
```typescript
import { QuizModule } from '../quiz/quiz.module';
// ...
@Module({
  imports: [GoogleSheetsModule, GeminiModule, QuizModule],
  providers: [DiscordService],
})
```

## 5. src/discord/discord.service.ts — thêm slash command
**5a.** Import + field:
```typescript
import {
  Client, Events, GatewayIntentBits, Message,
  SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, MessageFlags,
} from 'discord.js';
import { QuizService } from '../quiz/quiz.service';
```
Constructor inject `private readonly quiz: QuizService`. Thêm field `private readonly guildId = this.config.getOrThrow<string>('DISCORD_GUILD_ID');`

**5b.** Trong `onModuleInit`, sau `ClientReady` đăng ký command + thêm listener interaction:
```typescript
    this.client.once(Events.ClientReady, (c) => {
      this.logger.log(`Discord logged in as ${c.user.tag}, watching channel ${this.channelId}`);
      void this.registerCommands();
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isChatInputCommand() && interaction.commandName === 'add-quiz') {
        void this.handleAddQuiz(interaction);
      }
    });
```

**5c.** Đăng ký command theo guild:
```typescript
  private async registerCommands(): Promise<void> {
    try {
      const cmd = new SlashCommandBuilder()
        .setName('add-quiz')
        .setDescription('Tải lên đề (PDF/DOCX), AI giải và lưu đáp án + chỉ dẫn chấm')
        .addAttachmentOption((o) =>
          o.setName('file').setDescription('File đề PDF hoặc DOCX').setRequired(true),
        );
      const guild = await this.client.guilds.fetch(this.guildId);
      await guild.commands.set([cmd.toJSON()]);
      this.logger.log(`Đã đăng ký slash command /add-quiz cho guild ${this.guildId}`);
    } catch (err) {
      this.logger.error(`Đăng ký /add-quiz lỗi: ${(err as Error).message}`);
    }
  }
```

**5d.** Handler interaction:
```typescript
  private async handleAddQuiz(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const file = interaction.options.getAttachment('file', true);
    this.logger.log(`/add-quiz từ ${interaction.user.tag}: ${file.name} (${file.contentType})`);
    await interaction.deferReply();

    const mime = file.contentType?.split(';')[0] ?? '';
    if (!this.quiz.isSupported(mime)) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Định dạng không hỗ trợ')
            .setDescription(`Chỉ nhận PDF hoặc DOCX. File: ${file.name} (${mime || 'unknown'})`),
        ],
      });
      return;
    }

    try {
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`tải file fail HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      const result = await this.quiz.solveAndSave(buffer, mime, file.name);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle(`✅ ${result.title || result.originalName}`)
            .setDescription(`Đã giải **${result.questionCount}** câu`)
            .addFields(
              { name: 'File đề', value: result.originalName },
              { name: 'Đã lưu', value: '`' + result.savedPath + '`' },
            ),
        ],
      });
    } catch (err) {
      this.logger.error(`/add-quiz xử lý lỗi: ${(err as Error).message}`);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Giải đề thất bại')
            .setDescription((err as Error).message.slice(0, 1000)),
        ],
      });
    }
  }
```

## 6. README.md — bổ sung
- Mục "Giải đề bằng /add-quiz (task 3)": gõ `/add-quiz` + đính kèm PDF/DOCX → AI giải → embed báo tên đề + số câu → file markdown lưu ở `database/`.
- Thêm `DISCORD_GUILD_ID` vào bảng env.
- Mời bot với scope **`applications.commands`** (OAuth2 URL Generator: tick cả `bot` + `applications.commands`).
- Lưu ý: command guild-scoped hiện ngay; file đáp án nằm trong `database/` (đã gitignore).

## 7. Encapsulation / wiring notes
- DiscordService chỉ gọi `QuizService.solveAndSave` / `isSupported` — không tự parse file hay gọi AI.
- DiscordModule phải `imports: [..., QuizModule]` để resolve QuizService.
- Interaction KHÔNG dùng `seenSet` (không cần dedup).
- `deferReply()` bắt buộc (giải đề > 3s, tránh "interaction failed").

## 8. Acceptance criteria
- [ ] `npm run typecheck` pass.
- [ ] `npm run build` pass.
- [ ] `npm run start:dev` boot OK; log "Đã đăng ký slash command /add-quiz cho guild ...".
- [ ] Trong Discord gõ `/add-quiz` → thấy command, đính kèm 1 PDF đề → bot trả embed xanh "Đã giải N câu", file `.md` xuất hiện trong `database/` (cần GEMINI_API_KEY + DISCORD_GUILD_ID thật, bot mời với applications.commands).
- [ ] Đính kèm file `.txt`/ảnh → embed đỏ "Định dạng không hỗ trợ".
- [ ] Regression: log message thường (task 1) + ảnh hóa đơn (task 2) vẫn hoạt động.

## 9. Out of scope (phase này)
- Phân quyền dùng command, rate limit.
- Hỗ trợ thêm định dạng.
- Đính kèm file .md vào reply (chỉ báo đường dẫn).

## 10. Commit message dự kiến
```
feat(discord): /add-quiz slash command — solve exam, embed reply

Đăng ký slash command /add-quiz (guild-scoped DISCORD_GUILD_ID) nhận
attachment PDF/DOCX, dispatch sang QuizService giải đề + lưu markdown vào
database/, reply embed tên đề + số câu đã giải. Thêm env DISCORD_GUILD_ID.
README hướng dẫn mời bot với scope applications.commands.
```
