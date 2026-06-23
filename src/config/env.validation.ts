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

  // API key Gemini cho luồng đọc/chấm bài làm + giải đề.
  @IsString()
  GEMINI_API_KEY!: string;

  // Đường dẫn tới file service account JSON. Mặc định: service-account.json (ở cwd).
  @IsOptional()
  @IsString()
  GOOGLE_SERVICE_ACCOUNT_FILE?: string;
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
