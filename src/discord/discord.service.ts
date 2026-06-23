import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  Attachment,
} from "discord.js";
import {
  GoogleSheetsService,
  CellValue,
} from "../shared/google-sheets/google-sheets.service";
import { GoogleDriveService } from "../shared/google-drive/google-drive.service";
import { QuizService } from "../quiz/quiz.service";
import { GradeService, GradeImage } from "../grade/grade.service";

const IMAGE_OPTION_NAMES = ["file", "file2", "file3", "file4", "file5"];

// mime ảnh → đuôi file (đặt tên file trên Drive).
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);
  private readonly client: Client;
  private readonly sheetId: string;
  private readonly guildId: string;
  private readonly driveFolderId: string;
  private sheetRange = "";

  constructor(
    private readonly config: ConfigService,
    private readonly sheets: GoogleSheetsService,
    private readonly drive: GoogleDriveService,
    private readonly quiz: QuizService,
    private readonly grade: GradeService,
  ) {
    this.sheetId = this.config.getOrThrow<string>("GOOGLE_SHEET_ID");
    this.guildId = this.config.getOrThrow<string>("DISCORD_GUILD_ID");
    this.driveFolderId = this.config.getOrThrow<string>(
      "GOOGLE_DRIVE_FOLDER_ID",
    );
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
      if (interaction.isAutocomplete()) {
        if (interaction.commandName === "grading") {
          void this.handleGradingAutocomplete(interaction);
        }
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === "add-quiz") {
        void this.handleAddQuiz(interaction);
      } else if (interaction.commandName === "grading") {
        void this.handleGrade(interaction);
      }
    });

    const token = this.config.getOrThrow<string>("DISCORD_BOT_TOKEN");
    await this.client.login(token);
  }

  async onModuleDestroy() {
    await this.client.destroy();
  }

  /** Đăng ký /add-quiz + /grading theo guild (hiện ngay). */
  private async registerCommands(): Promise<void> {
    try {
      const addQuiz = new SlashCommandBuilder()
        .setName("add-quiz")
        .setDescription(
          "Tải lên đề (PDF/DOCX), AI giải và lưu đáp án + chỉ dẫn chấm",
        )
        .addAttachmentOption((o) =>
          o
            .setName("file")
            .setDescription("File đề PDF hoặc DOCX")
            .setRequired(true),
        );

      // Nhập tay mã đề (chọn file đáp án) + ảnh; AI đọc thông tin thí sinh,
      // mã đề (đối chiếu) và câu trả lời.
      const grading = new SlashCommandBuilder()
        .setName("grading")
        .setDescription(
          "Chấm bài làm từ ảnh: AI đọc thông tin thí sinh + chấm điểm, ghi vào Google Sheet",
        )
        .addAttachmentOption((o) =>
          o
            .setName("file")
            .setDescription("Ảnh bài làm (trang 1)")
            .setRequired(true),
        )
        .addAttachmentOption((o) =>
          o
            .setName("file2")
            .setDescription("Ảnh bài làm trang 2")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("exam_code")
            .setDescription("Chọn đề (rcv-<mã đề>) để chấm")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addAttachmentOption((o) =>
          o.setName("file3").setDescription("Ảnh bài làm trang 3 (tùy chọn)"),
        )
        .addAttachmentOption((o) =>
          o.setName("file4").setDescription("Ảnh bài làm trang 4 (tùy chọn)"),
        )
        .addAttachmentOption((o) =>
          o.setName("file5").setDescription("Ảnh bài làm trang 5 (tùy chọn)"),
        );

      const guild = await this.client.guilds.fetch(this.guildId);
      await guild.commands.set([addQuiz.toJSON(), grading.toJSON()]);
      this.logger.log(
        `Đã đăng ký /add-quiz + /grading cho guild ${this.guildId}`,
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
    const file = interaction.options.getAttachment("file", true);
    this.logger.log(
      `/add-quiz từ ${interaction.user.tag}: ${file.name} (${file.contentType})`,
    );
    await interaction.deferReply();

    const mime = file.contentType?.split(";")[0] ?? "";
    if (!this.quiz.isSupported(mime)) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Định dạng không hỗ trợ")
            .setDescription(
              `Chỉ nhận PDF hoặc DOCX. File: ${file.name} (${mime || "unknown"})`,
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
            .setDescription(
              `Đã trích **${result.questionCount}** câu • Mã đề: **${result.examCode || "(?)"}**`,
            )
            .addFields(
              { name: "File đề", value: result.originalName },
              { name: "Đáp án (JSON)", value: "`" + result.savedPath + "`" },
              { name: "Bản giải (MD)", value: "`" + result.mdPath + "`" },
            ),
        ],
      });
    } catch (err) {
      this.logger.error(`/add-quiz xử lý lỗi: ${(err as Error).message}`);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Giải đề thất bại")
            .setDescription((err as Error).message.slice(0, 1000)),
        ],
      });
    }
  }

  /**
   * Autocomplete cho option exam_code của /grading: liệt kê đề trong database
   * dưới dạng "rcv-<mã đề>". value gửi đi là mã đề (để GradeService khớp).
   */
  private async handleGradingAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    try {
      const focused = interaction.options.getFocused().toString().toLowerCase();
      const exams = await this.grade.listExams();
      const choices = exams
        .filter((e) => {
          const label = `rcv-${e.examCode}`.toLowerCase();
          return (
            !focused ||
            label.includes(focused) ||
            e.title.toLowerCase().includes(focused)
          );
        })
        .slice(0, 25)
        .map((e) => ({
          name: `rcv-${e.examCode}`.slice(0, 100),
          value: e.examCode,
        }));
      await interaction.respond(choices);
    } catch (err) {
      this.logger.warn(`Autocomplete /grading lỗi: ${(err as Error).message}`);
      try {
        await interaction.respond([]);
      } catch {
        // ignore — interaction có thể đã hết hạn
      }
    }
  }

  /**
   * Xử lý /grading: gom ảnh bài làm → GradeService đọc thông tin thí sinh +
   * chấm → append sheet → embed. Cột A→F lấy từ dữ liệu AI trích:
   * Họ tên, Bố mẹ, SĐT bố mẹ, Lớp, Điểm, Link ảnh.
   */
  private async handleGrade(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply();
    const examCode = interaction.options.getString("exam_code", true);

    const images: Attachment[] = IMAGE_OPTION_NAMES.map((n) =>
      interaction.options.getAttachment(n),
    )
      .filter((a): a is Attachment => !!a)
      .filter((a) => a.contentType?.startsWith("image/"));

    this.logger.log(
      `/grading từ ${interaction.user.tag}: mã đề=${examCode}, ${images.length} ảnh`,
    );

    if (images.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Không có ảnh bài làm")
            .setDescription("Cần ít nhất 1 ảnh (image/*) ở option `file`."),
        ],
      });
      return;
    }

    try {
      // Tải ảnh về buffer → upload Drive (CDN Discord hết hạn) + base64 cho Gemini.
      const { loaded, links } = await this.uploadImagesToDrive(
        images,
        examCode,
      );

      const result = await this.grade.grade(examCode, loaded);

      // Link Drive (nối nhiều ảnh bằng newline) — ghi vào Sheet.
      const imageLinks = links.join("\n");

      // Lazy resolve worksheet nếu boot-time verify thất bại.
      if (!this.sheetRange) {
        this.sheetRange = await this.sheets.getFirstSheetTitle(this.sheetId);
      }

      // Cột A→F = thông tin AI trích + điểm + link ảnh.
      const row: CellValue[] = [
        result.fullName,
        result.parentName,
        result.parentPhone,
        result.className,
        result.score,
        imageLinks,
      ];
      await this.sheets.appendRow(this.sheetId, this.sheetRange, row);
      this.logger.log(
        `✅ Đã ghi điểm "${result.fullName}" ${result.score} (mã đề ${examCode}) vào sheet`,
      );

      // Đối chiếu mã đề nhập tay vs mã đề AI đọc từ ảnh.
      const codeMismatch =
        result.extractedExamCode &&
        result.extractedExamCode.toUpperCase() !==
          examCode.trim().toUpperCase();

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`✅ Đã chấm: ${result.fullName || "(không đọc được tên)"}`)
        .setDescription(`**Điểm:** ${result.score}  •  **Mã đề:** ${examCode}`)
        .addFields(
          { name: "Lớp", value: result.className || "-", inline: true },
          { name: "Bố mẹ", value: result.parentName || "-", inline: true },
          { name: "SĐT", value: result.parentPhone || "-", inline: true },
          { name: "Đáp án dùng", value: result.matchedFile },
          {
            name: "Mã đề trên ảnh",
            value: `${result.extractedExamCode || "(không đọc được)"}${
              codeMismatch ? " ⚠️ lệch mã đề nhập tay" : ""
            }`,
          },
        );
      // Chi tiết từng câu: đáp án thí sinh + đúng/sai (kèm đáp án đúng nếu sai).
      // Discord giới hạn 1024 ký tự/field → chia thành nhiều field nếu đề dài.
      const detailLines = result.questions.map((q) => {
        const ans = q.studentAnswer || "∅";
        return q.isCorrect
          ? `Câu ${q.id}: ${ans} ✅`
          : `Câu ${q.id}: ${ans} ❌ (đúng: ${q.correctAnswer || "?"})`;
      });
      this.addDetailFields(embed, detailLines);

      if (result.note) {
        embed.addFields({ name: "Ghi chú", value: result.note.slice(0, 1000) });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      this.logger.error(`/grading xử lý lỗi: ${(err as Error).message}`);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("❌ Chấm bài thất bại")
            .setDescription((err as Error).message.slice(0, 1000)),
        ],
      });
    }
  }

  /**
   * Gom các dòng chi tiết câu thành các field embed, mỗi field ≤ 1024 ký tự
   * (giới hạn Discord). Field đầu tên "Chi tiết", các field tiếp "Chi tiết (tiếp)".
   */
  private addDetailFields(embed: EmbedBuilder, lines: string[]): void {
    if (lines.length === 0) return;
    const MAX = 1024;
    let buf = "";
    let first = true;
    const flush = () => {
      if (!buf) return;
      embed.addFields({ name: first ? "Chi tiết" : "Chi tiết (tiếp)", value: buf });
      first = false;
      buf = "";
    };
    for (const line of lines) {
      // +1 cho ký tự xuống dòng khi nối thêm.
      if (buf && buf.length + 1 + line.length > MAX) flush();
      buf = buf ? `${buf}\n${line}` : line;
    }
    flush();
  }

  /**
   * Tải các ảnh bài làm từ CDN Discord về buffer, UPLOAD lên folder Drive (vì
   * link CDN hết hạn), đồng thời trả base64 cho Gemini và link Drive đã upload.
   */
  private async uploadImagesToDrive(
    images: Attachment[],
    examCode: string,
  ): Promise<{ loaded: GradeImage[]; links: string[] }> {
    const stamp = Date.now();
    const slug =
      examCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "exam";

    const loaded: GradeImage[] = [];
    const links: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const a = images[i];
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`tải ảnh ${a.name} fail HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = a.contentType?.split(";")[0] ?? "image/jpeg";
      const ext =
        EXT_BY_MIME[mime] ?? a.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const name = `rcv-${slug}-${stamp}-${i + 1}.${ext}`;
      const up = await this.drive.uploadFile(
        this.driveFolderId,
        name,
        mime,
        buf,
      );
      loaded.push({ base64: buf.toString("base64"), mime });
      links.push(up.link);
    }
    this.logger.log(`Đã upload ${links.length} ảnh bài làm lên Drive`);
    return { loaded, links };
  }
}
