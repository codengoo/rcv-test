import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsString()
  DISCORD_BOT_TOKEN!: string;

  // ID server (guild) để đăng ký slash command /add-quiz, /grading.
  @IsString()
  DISCORD_GUILD_ID!: string;

  @IsString()
  GOOGLE_SHEET_ID!: string;

  // ID folder Google Drive để lưu ảnh bài làm (link CDN Discord hết hạn).
  @IsString()
  GOOGLE_DRIVE_FOLDER_ID!: string;

  // OAuth2 của TÀI KHOẢN người dùng để upload Drive (service account không có
  // quota lưu trữ). Lấy refresh token 1 lần bằng: npm run token:drive
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID!: string;

  @IsString()
  GOOGLE_OAUTH_CLIENT_SECRET!: string;

  @IsString()
  GOOGLE_OAUTH_REFRESH_TOKEN!: string;

  // API key Gemini cho luồng đọc/chấm bài làm + giải đề.
  @IsString()
  GEMINI_API_KEY!: string;

  // Đường dẫn tới file service account JSON. Mặc định: service-account.json (ở cwd).
  @IsOptional()
  @IsString()
  GOOGLE_SERVICE_ACCOUNT_FILE?: string;

  // Chuỗi kết nối MongoDB (local hoặc Atlas). Nguồn dữ liệu chính cho đề + kết quả.
  @IsString()
  MONGODB_URI!: string;

  // Cổng HTTP server (REST API + React build). Mặc định 3000.
  @IsOptional()
  @IsString()
  PORT?: string;

  // Base URL trang tra cứu kết quả (chèn link vào reply Discord).
  // Mặc định https://rcv-result.nghiacn.cloud nếu bỏ trống.
  @IsOptional()
  @IsString()
  RESULT_WEB_URL?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment variables:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }
  return validated;
}
