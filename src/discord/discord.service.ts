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
import {
  SubmissionService,
  formatScore,
} from "../submission/submission.service";
import sharp from "sharp";

/** Ảnh đã upload Drive: giữ fileId (FE dựng URL) + link (ghi Sheet). */
interface UploadedImage {
  fileId: string;
  link: string;
}

/** Ảnh đã tải + nén, sẵn sàng cho cả Gemini lẫn Drive. */
interface PreparedImage {
  buf: Buffer;
  mime: string;
  ext: string;
}

const IMAGE_OPTION_NAMES = ["file", "file2", "file3", "file4", "file5"];

// Nén ảnh trước khi gửi: ≤ 2000px / JPEG q82 → thường < 2MB nên Gemini nhúng
// inline (bỏ File API ~8-10s) + vision nhanh hơn, vẫn đủ nét cho OCR chữ viết tay.
const MAX_IMAGE_DIM = 2000;
const JPEG_QUALITY = 82;

// mime ảnh → đuôi file (đặt tên file trên Drive).
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

type StepStatus = "pending" | "running" | "done" | "error";

// Icon hiển thị trạng thái từng bước trong embed tiến độ.
const STEP_ICON: Record<StepStatus, string> = {
  pending: "⚪",
  running: "⏳",
  done: "✅",
  error: "❌",
};

/**
 * Báo tiến độ từng bước vào reply đã defer để người dùng theo dõi (đỡ ngóng).
 * Mỗi lần `begin(i)` đánh dấu bước trước là xong, bước i đang chạy, rồi cập nhật
 * embed. Lỗi khi edit (interaction hết hạn…) bị nuốt — tiến độ chỉ là best-effort,
 * không được làm hỏng luồng chính.
 */
class StepProgress {
  private readonly status: StepStatus[];
  private current = -1;

  constructor(
    private readonly interaction: ChatInputCommandInteraction,
    private readonly title: string,
    private readonly labels: string[],
  ) {
    this.status = labels.map(() => "pending");
  }

  /** Đánh dấu bước trước xong, bắt đầu bước i, cập nhật embed. */
  async begin(i: number): Promise<void> {
    if (this.current >= 0 && this.status[this.current] === "running") {
      this.status[this.current] = "done";
    }
    this.current = i;
    this.status[i] = "running";
    await this.render();
  }

  private async render(): Promise<void> {
    const lines = this.labels.map(
      (label, i) => `${STEP_ICON[this.status[i]]} ${label}`,
    );
    try {
      await this.interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(this.title)
            .setDescription(lines.join("\n")),
        ],
      });
    } catch {
      // best-effort: không chặn luồng chính nếu cập nhật tiến độ thất bại.
    }
  }
}

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);
  private readonly client: Client;
  private readonly sheetId: string;
  private readonly guildId: string;
  private readonly driveFolderId: string;
  private readonly resultWebUrl: string;
  private sheetRange = "";

  constructor(
    private readonly config: ConfigService,
    private readonly sheets: GoogleSheetsService,
    private readonly drive: GoogleDriveService,
    private readonly quiz: QuizService,
    private readonly grade: GradeService,
    private readonly submissions: SubmissionService,
  ) {
    this.sheetId = this.config.getOrThrow<string>("GOOGLE_SHEET_ID");
    this.guildId = this.config.getOrThrow<string>("DISCORD_GUILD_ID");
    this.driveFolderId = this.config.getOrThrow<string>(
      "GOOGLE_DRIVE_FOLDER_ID",
    );
    // Base URL trang tra cứu kết quả (để chèn link vào reply). Có thể override
    // qua env RESULT_WEB_URL; mặc định domain production.
    this.resultWebUrl =
      this.config.get<string>("RESULT_WEB_URL") ??
      "https://rcv-result.nghiacn.cloud";
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

    const progress = new StepProgress(interaction, "⏳ Đang giải đề…", [
      "Tải file từ Discord",
      "Giải đề & lưu đáp án (AI)",
    ]);

    try {
      await progress.begin(0);
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`tải file fail HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      await progress.begin(1);
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
    const t0 = Date.now();
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

    const progress = new StepProgress(interaction, "⏳ Đang chấm bài…", [
      `Tải & nén ${images.length} ảnh`,
      "Chấm bài (AI) & tải ảnh lên Drive",
      "Ghi điểm vào Sheet & lưu kết quả",
    ]);

    try {
      // 1) Tải + nén ảnh (song song) — 1 buffer dùng cho cả Gemini lẫn Drive.
      await progress.begin(0);
      const prepared = await this.prepareImages(images);
      const gradeImages: GradeImage[] = prepared.map((p) => ({
        base64: p.buf.toString("base64"),
        mime: p.mime,
      }));

      // Resolve worksheet sớm nếu boot-time verify thất bại.
      if (!this.sheetRange) {
        this.sheetRange = await this.sheets.getFirstSheetTitle(this.sheetId);
      }

      // 2) CHẤM (Gemini) và UPLOAD DRIVE chạy SONG SONG — 2 việc nặng nhất.
      await progress.begin(1);
      const [result, uploaded] = await Promise.all([
        this.grade.grade(examCode, gradeImages),
        this.uploadAllToDrive(prepared, examCode),
      ]);

      // Link Drive (nối nhiều ảnh bằng newline) — ghi vào Sheet.
      const imageLinks = uploaded.map((u) => u.link).join("\n");
      const scoreText = formatScore(result.totalScore); // "3.75"

      // 3) Lưu Mongo TRƯỚC (cần _id + reviewCode để dựng link), best-effort.
      await progress.begin(2);
      const submission = await this.submissions
        .create({
          examCode: result.examCode,
          fullName: result.fullName,
          parentName: result.parentName,
          parentPhone: result.parentPhone,
          className: result.className,
          dob: "", // không dùng cho accessCode (giờ là 6 số cuối SĐT)
          score: result.score,
          correctCount: result.correctCount,
          totalQuestions: result.totalQuestions,
          totalScore: result.totalScore,
          maxScore: result.maxScore,
          questions: result.questions,
          images: uploaded,
          note: result.note,
        })
        .catch((err: Error) => {
          this.logger.warn(
            `Lưu submission vào Mongo thất bại (bài chấm vẫn OK): ${err.message}`,
          );
          return null;
        });

      const resultId = submission?._id?.toString() ?? "";
      const resultLink = resultId
        ? `${this.resultWebUrl}?result_id=${resultId}`
        : "";
      // Link sửa cho giám thị: code 6 số trong URL = quyền truy cập.
      const reviewLink = submission?.reviewCode
        ? `${this.resultWebUrl}?review_code=${submission.reviewCode}`
        : "";

      // 4) Ghi Sheet 7 cột rồi lưu lại range để giám thị cập nhật điểm sau.
      // A Họ tên HS · B Tên bố/mẹ · C SĐT · D Lớp · E Điểm · F Link ảnh · G Link xem KQ.
      const row: CellValue[] = [
        result.fullName,
        result.parentName,
        result.parentPhone,
        result.className,
        `${scoreText} điểm`,
        imageLinks,
        resultLink,
      ];
      try {
        const range = await this.sheets.appendRow(
          this.sheetId,
          this.sheetRange,
          row,
        );
        this.logger.log(
          `✅ Đã ghi điểm "${result.fullName}" ${scoreText}đ (mã đề ${examCode}) vào sheet ${range || "?"}`,
        );
        if (resultId && range) {
          await this.submissions.setSheetRange(resultId, range);
        }
      } catch (err) {
        this.logger.error(`Ghi Sheet thất bại: ${(err as Error).message}`);
      }

      // Thời gian xử lý.
      const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

      // Đối chiếu mã đề nhập tay vs mã đề AI đọc từ ảnh.
      const codeMismatch =
        result.extractedExamCode &&
        result.extractedExamCode.toUpperCase() !==
          examCode.trim().toUpperCase();

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`✅ Đã chấm: ${result.fullName || "(không đọc được tên)"}`)
        .setDescription(
          `**Điểm:** ${scoreText} điểm  •  **Mã đề:** ${examCode}`,
        )
        .addFields(
          { name: "Lớp", value: result.className || "-", inline: true },
          { name: "Bố mẹ", value: result.parentName || "-", inline: true },
          { name: "SĐT", value: result.parentPhone || "-", inline: true },
          { name: "Trạng thái", value: "🟡 Đã chấm tự động", inline: true },
          { name: "Đáp án dùng", value: result.matchedFile },
          {
            name: "Mã đề trên ảnh",
            value: `${result.extractedExamCode || "(không đọc được)"}${
              codeMismatch ? " ⚠️ lệch mã đề nhập tay" : ""
            }`,
          },
          { name: "⏱️ Thời gian xử lý", value: `${elapsedSec}s`, inline: true },
        );
      if (resultLink) {
        embed.addFields({ name: "🔗 Xem kết quả", value: resultLink });
      }
      if (reviewLink) {
        embed.addFields({
          name: "✍️ Cán bộ chấm thi sửa kết quả",
          value: reviewLink,
        });
      }
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
   * Tải các ảnh từ CDN Discord (SONG SONG) và NÉN bằng sharp xuống ≤ 2000px /
   * JPEG q82 — nhỏ < 2MB để Gemini nhúng inline (bỏ File API) + vision nhanh hơn,
   * vẫn đủ nét cho OCR. Lỗi nén 1 ảnh → fallback dùng buffer gốc.
   */
  private async prepareImages(
    images: Attachment[],
  ): Promise<PreparedImage[]> {
    return Promise.all(
      images.map(async (a) => {
        const res = await fetch(a.proxyURL);
        if (!res.ok)
          throw new Error(`tải ảnh ${a.name} fail HTTP ${res.status}`);
        const raw = Buffer.from(await res.arrayBuffer());
        try {
          const buf = await sharp(raw)
            .rotate() // tự xoay theo EXIF (ảnh chụp điện thoại)
            .resize({
              width: MAX_IMAGE_DIM,
              height: MAX_IMAGE_DIM,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: JPEG_QUALITY })
            .toBuffer();
          return { buf, mime: "image/jpeg", ext: "jpg" };
        } catch (err) {
          this.logger.warn(
            `Nén ảnh ${a.name} lỗi, dùng ảnh gốc: ${(err as Error).message}`,
          );
          const mime = a.contentType?.split(";")[0] ?? "image/jpeg";
          const ext =
            EXT_BY_MIME[mime] ??
            a.name.split(".").pop()?.toLowerCase() ??
            "jpg";
          return { buf: raw, mime, ext };
        }
      }),
    );
  }

  /**
   * Upload các ảnh đã nén lên folder Drive SONG SONG (link CDN Discord hết hạn).
   */
  private async uploadAllToDrive(
    prepared: PreparedImage[],
    examCode: string,
  ): Promise<UploadedImage[]> {
    const stamp = Date.now();
    const slug =
      examCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "exam";
    const uploaded = await Promise.all(
      prepared.map(async (p, i) => {
        const name = `rcv-${slug}-${stamp}-${i + 1}.${p.ext}`;
        const up = await this.drive.uploadFile(
          this.driveFolderId,
          name,
          p.mime,
          p.buf,
        );
        return { fileId: up.id, link: up.link };
      }),
    );
    this.logger.log(`Đã upload ${uploaded.length} ảnh bài làm lên Drive`);
    return uploaded;
  }
}
