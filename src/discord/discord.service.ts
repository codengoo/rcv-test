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
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  Attachment,
} from 'discord.js';
import {
  GoogleSheetsService,
  CellValue,
} from '../shared/google-sheets/google-sheets.service';
import { QuizService } from '../quiz/quiz.service';
import { GradeService, GradeImage } from '../grade/grade.service';

const IMAGE_OPTION_NAMES = ['file', 'file2', 'file3', 'file4', 'file5'];

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);
  private readonly client: Client;
  private readonly sheetId: string;
  private readonly guildId: string;
  private sheetRange = '';

  constructor(
    private readonly config: ConfigService,
    private readonly sheets: GoogleSheetsService,
    private readonly quiz: QuizService,
    private readonly grade: GradeService,
  ) {
    this.sheetId = this.config.getOrThrow<string>('GOOGLE_SHEET_ID');
    this.guildId = this.config.getOrThrow<string>('DISCORD_GUILD_ID');
    // Chỉ cần Guilds (slash command). Không đọc nội dung message nữa.
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
  }

  async onModuleInit() {
    try {
      this.sheetRange = await this.sheets.getFirstSheetTitle(this.sheetId);
      this.logger.log(`Connected to sheet "${this.sheetRange}"`);
    } catch (err) {
      this.logger.error(
        `Không kết nối được Google Sheet (sẽ thử lại khi append): ${(err as Error).message}`,
      );
    }

    this.client.once(Events.ClientReady, (c) => {
      this.logger.log(`Discord logged in as ${c.user.tag}`);
      void this.registerCommands();
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === 'add-quiz') {
        void this.handleAddQuiz(interaction);
      } else if (interaction.commandName === 'cham-bai') {
        void this.handleGrade(interaction);
      }
    });

    const token = this.config.getOrThrow<string>('DISCORD_BOT_TOKEN');
    await this.client.login(token);
  }

  async onModuleDestroy() {
    await this.client.destroy();
  }

  /** Đăng ký /add-quiz + /cham-bai theo guild (hiện ngay). */
  private async registerCommands(): Promise<void> {
    try {
      const addQuiz = new SlashCommandBuilder()
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

      // Lưu ý: option bắt buộc phải đứng TRƯỚC option tùy chọn.
      const chamBai = new SlashCommandBuilder()
        .setName('cham-bai')
        .setDescription(
          'Chấm bài làm của thí sinh từ ảnh, ghi điểm vào Google Sheet',
        )
        .addAttachmentOption((o) =>
          o
            .setName('file')
            .setDescription('Ảnh bài làm (trang 1)')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('hoten').setDescription('Họ tên thí sinh').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('bome').setDescription('Tên bố mẹ').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('sdt')
            .setDescription('Số điện thoại bố mẹ')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('lop').setDescription('Lớp của thí sinh').setRequired(true),
        )
        .addAttachmentOption((o) =>
          o.setName('file2').setDescription('Ảnh bài làm trang 2 (tùy chọn)'),
        )
        .addAttachmentOption((o) =>
          o.setName('file3').setDescription('Ảnh bài làm trang 3 (tùy chọn)'),
        )
        .addAttachmentOption((o) =>
          o.setName('file4').setDescription('Ảnh bài làm trang 4 (tùy chọn)'),
        )
        .addAttachmentOption((o) =>
          o.setName('file5').setDescription('Ảnh bài làm trang 5 (tùy chọn)'),
        );

      const guild = await this.client.guilds.fetch(this.guildId);
      await guild.commands.set([addQuiz.toJSON(), chamBai.toJSON()]);
      this.logger.log(
        `Đã đăng ký /add-quiz + /cham-bai cho guild ${this.guildId}`,
      );
    } catch (err) {
      this.logger.error(
        `Đăng ký slash command lỗi (kiểm tra DISCORD_GUILD_ID + scope applications.commands): ${(err as Error).message}`,
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

  /**
   * Xử lý /cham-bai: gom ảnh bài làm → GradeService chấm → append sheet → embed.
   * Cột A→F: Họ tên, Bố mẹ, SĐT bố mẹ, Lớp, Điểm, Link ảnh.
   */
  private async handleGrade(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply();
    const hoten = interaction.options.getString('hoten', true);
    const bome = interaction.options.getString('bome', true);
    const sdt = interaction.options.getString('sdt', true);
    const lop = interaction.options.getString('lop', true);

    const images: Attachment[] = IMAGE_OPTION_NAMES.map((n) =>
      interaction.options.getAttachment(n),
    )
      .filter((a): a is Attachment => !!a)
      .filter((a) => a.contentType?.startsWith('image/'));

    this.logger.log(
      `/cham-bai từ ${interaction.user.tag}: thí sinh="${hoten}" lớp="${lop}" ảnh=${images.length}`,
    );

    if (images.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Không có ảnh bài làm')
            .setDescription('Cần ít nhất 1 ảnh (image/*) ở option `file`.'),
        ],
      });
      return;
    }

    try {
      // Tải ảnh → base64.
      const loaded: GradeImage[] = await Promise.all(
        images.map(async (a) => {
          const res = await fetch(a.url);
          if (!res.ok)
            throw new Error(`tải ảnh ${a.name} fail HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          return {
            base64: buf.toString('base64'),
            mime: a.contentType ?? 'image/jpeg',
          };
        }),
      );

      const result = await this.grade.grade(loaded);

      // Link ảnh CDN discord (nối nhiều ảnh bằng newline).
      const imageLinks = images.map((a) => a.url).join('\n');

      // Lazy resolve worksheet nếu boot-time verify thất bại.
      if (!this.sheetRange) {
        this.sheetRange = await this.sheets.getFirstSheetTitle(this.sheetId);
      }

      const row: CellValue[] = [hoten, bome, sdt, lop, result.score, imageLinks];
      await this.sheets.appendRow(this.sheetId, this.sheetRange, row);
      this.logger.log(
        `✅ Đã ghi điểm "${hoten}" ${result.score} (mã đề ${result.maDe}) vào sheet`,
      );

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`✅ Đã chấm: ${hoten}`)
        .setDescription(
          `**Điểm:** ${result.score}  •  **Mã đề:** ${result.maDe || '(không đọc được)'}`,
        )
        .addFields(
          { name: 'Lớp', value: lop || '-', inline: true },
          { name: 'Bố mẹ', value: bome || '-', inline: true },
          { name: 'SĐT', value: sdt || '-', inline: true },
          {
            name: 'Đáp án dùng',
            value: result.matchedFile || '(AI chọn đề gần nhất)',
          },
        );
      if (result.note) {
        embed.addFields({ name: 'Ghi chú', value: result.note.slice(0, 1000) });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      this.logger.error(`/cham-bai xử lý lỗi: ${(err as Error).message}`);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Chấm bài thất bại')
            .setDescription((err as Error).message.slice(0, 1000)),
        ],
      });
    }
  }
}
