import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import {
  GoogleSheetsService,
  CellValue,
} from '../shared/google-sheets/google-sheets.service';
import { GeminiService } from '../shared/gemini/gemini.service';
import { receiptSchema } from './receipt.schema';
import { QuizService } from '../quiz/quiz.service';

const SEEN_CAP = 5000;

const RECEIPT_PROMPT =
  'Đây là ảnh một hóa đơn (receipt). Hãy trích xuất thông tin cửa hàng và ' +
  'tổng giá trị đơn theo đúng schema. Nếu một trường không có: trả "" cho text, ' +
  '0 cho total. total phải là số thuần (bỏ ký hiệu tiền tệ và dấu phân cách nghìn).';

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);
  private readonly client: Client;
  private readonly channelId: string;
  private readonly sheetId: string;
  private readonly guildId: string;
  private sheetRange = '';
  private readonly seen = new Set<string>();
  private readonly seenQueue: string[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly sheets: GoogleSheetsService,
    private readonly gemini: GeminiService,
    private readonly quiz: QuizService,
  ) {
    this.channelId = this.config.getOrThrow<string>('DISCORD_CHANNEL_ID');
    this.sheetId = this.config.getOrThrow<string>('GOOGLE_SHEET_ID');
    this.guildId = this.config.getOrThrow<string>('DISCORD_GUILD_ID');
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async onModuleInit() {
    // Verify + cache worksheet đích (cũng log "Connected to sheet").
    try {
      this.sheetRange = await this.sheets.getFirstSheetTitle(this.sheetId);
      this.logger.log(`Connected to sheet "${this.sheetRange}"`);
    } catch (err) {
      this.logger.error(
        `Không kết nối được Google Sheet (sẽ thử lại khi append): ${(err as Error).message}`,
      );
    }

    this.client.once(Events.ClientReady, (c) => {
      this.logger.log(
        `Discord logged in as ${c.user.tag}, watching channel ${this.channelId}`,
      );
      void this.registerCommands();
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === 'add-quiz'
      ) {
        void this.handleAddQuiz(interaction);
      }
    });

    const token = this.config.getOrThrow<string>('DISCORD_BOT_TOKEN');
    await this.client.login(token);
  }

  async onModuleDestroy() {
    await this.client.destroy();
  }

  /** Đăng ký slash command /add-quiz theo guild (hiện ngay). */
  private async registerCommands(): Promise<void> {
    try {
      const cmd = new SlashCommandBuilder()
        .setName('add-quiz')
        .setDescription(
          'Tải lên đề (PDF/DOCX), AI giải và lưu đáp án + chỉ dẫn chấm',
        )
        .addAttachmentOption((o) =>
          o
            .setName('file')
            .setDescription('File đề PDF hoặc DOCX')
            .setRequired(true),
        );
      const guild = await this.client.guilds.fetch(this.guildId);
      await guild.commands.set([cmd.toJSON()]);
      this.logger.log(
        `Đã đăng ký slash command /add-quiz cho guild ${this.guildId}`,
      );
    } catch (err) {
      this.logger.error(
        `Đăng ký /add-quiz lỗi (kiểm tra DISCORD_GUILD_ID + scope applications.commands): ${(err as Error).message}`,
      );
    }
  }

  /** Xử lý /add-quiz: tải file → QuizService giải đề + lưu → reply embed. */
  private async handleAddQuiz(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const file = interaction.options.getAttachment('file', true);
    this.logger.log(
      `/add-quiz từ ${interaction.user.tag}: ${file.name} (${file.contentType})`,
    );
    await interaction.deferReply();

    const mime = file.contentType?.split(';')[0] ?? '';
    if (!this.quiz.isSupported(mime)) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Định dạng không hỗ trợ')
            .setDescription(
              `Chỉ nhận PDF hoặc DOCX. File: ${file.name} (${mime || 'unknown'})`,
            ),
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

  private async handleMessage(message: Message): Promise<void> {
    // [1] Nhận event — log mọi message để biết handler có chạy không.
    this.logger.log(
      `[1/6] messageCreate nhận được: id=${message.id} channel=${message.channelId} author=${message.author.tag} attachments=${message.attachments.size}`,
    );

    // [2] Bộ lọc — log rõ lý do bị drop.
    if (message.channelId !== this.channelId) {
      this.logger.log(
        `[2/6] BỎ QUA: sai channel (nhận ${message.channelId}, theo dõi ${this.channelId})`,
      );
      return;
    }
    if (message.author.bot) {
      this.logger.log(`[2/6] BỎ QUA: message từ bot`);
      return;
    }
    if (this.isDuplicate(message.id)) {
      this.logger.log(`[2/6] BỎ QUA: trùng messageId ${message.id} (đã xử lý)`);
      return;
    }
    this.remember(message.id);
    this.logger.log(`[2/6] Qua bộ lọc, bắt đầu xử lý message ${message.id}`);

    try {
      // [3] Lazy resolve worksheet nếu boot-time verify thất bại.
      if (!this.sheetRange) {
        this.logger.log(`[3/6] Chưa có sheetRange, đang resolve worksheet...`);
        this.sheetRange = await this.sheets.getFirstSheetTitle(this.sheetId);
      }
      this.logger.log(`[3/6] Worksheet đích: "${this.sheetRange}"`);

      // Cột A→F: timestamp, author, authorId, channelId, messageId, content
      const row: CellValue[] = [
        message.createdAt.toISOString(),
        message.author.tag,
        message.author.id,
        message.channelId,
        message.id,
        message.content ?? '',
      ];

      // [4] Nếu có ảnh hóa đơn → trích xuất rồi nối cột G→K vào cùng row.
      const receiptCells = await this.tryExtractReceipt(message);
      if (receiptCells) {
        row.push(...receiptCells);
        this.logger.log(`[5/6] Đã nối 5 cột hóa đơn (G–K) vào row`);
      } else {
        this.logger.log(`[5/6] Không có dữ liệu hóa đơn, chỉ ghi A–F`);
      }

      // [6] Append vào sheet.
      this.logger.log(`[6/6] Đang append ${row.length} cột vào sheet...`);
      await this.sheets.appendRow(this.sheetId, this.sheetRange, row);
      this.logger.log(`[6/6] ✅ Đã ghi message ${message.id} vào sheet`);
    } catch (err) {
      // appendRow đã retry; tới đây là fail hẳn — log, không crash.
      this.logger.error(
        `❌ Không ghi được message ${message.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Nếu message có attachment image/* → tải ảnh đầu tiên, gọi Gemini, trả về
   * 5 cell G→K (storeName, storeAddress, date, total, currency). Lỗi
   * (download/Gemini) → log warning, trả null để fallback ghi A–F.
   */
  private async tryExtractReceipt(
    message: Message,
  ): Promise<CellValue[] | null> {
    const image = message.attachments.find((a) =>
      a.contentType?.startsWith('image/'),
    );
    if (!image) {
      this.logger.log(`[4/6] Không có ảnh đính kèm → bỏ qua trích hóa đơn`);
      return null;
    }
    if (message.attachments.size > 1) {
      this.logger.log(
        `[4/6] Có ${message.attachments.size} attachment, chỉ xử lý ảnh đầu tiên`,
      );
    }

    try {
      this.logger.log(
        `[4/6] Đang tải ảnh: ${image.name} (${image.contentType}, ${image.size} bytes)`,
      );
      const res = await fetch(image.url);
      if (!res.ok) throw new Error(`tải ảnh fail HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const base64 = buf.toString('base64');
      const mime = image.contentType ?? 'image/jpeg';
      this.logger.log(
        `[4/6] Tải xong (${buf.length} bytes), gọi Gemini trích hóa đơn...`,
      );

      const data = await this.gemini.extractStructured(
        receiptSchema,
        [
          this.gemini.textPart(RECEIPT_PROMPT),
          this.gemini.imagePart(base64, mime),
        ],
        { name: 'receipt' },
      );
      this.logger.log(
        `[4/6] ✅ Gemini trả: store="${data.storeName}" addr="${data.storeAddress}" date="${data.date}" total=${data.total} ${data.currency}`,
      );
      // Cột G→K
      return [
        data.storeName ?? '',
        data.storeAddress ?? '',
        data.date ?? '',
        data.total ?? '',
        data.currency ?? '',
      ];
    } catch (err) {
      this.logger.warn(
        `[4/6] ⚠️ Trích hóa đơn message ${message.id} thất bại, sẽ ghi A–F: ${(err as Error).message}`,
      );
      return null;
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
