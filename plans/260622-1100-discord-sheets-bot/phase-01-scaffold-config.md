# Phase 01 — Scaffold NestJS + Config

**Goal:** Sau phase này, `d:\rcv` là một NestJS project hợp lệ: `npm install` xong, `tsc --noEmit` pass, `npm run start:dev` boot được app rỗng và log `App started`. Env được validate khi boot (thiếu biến → throw rõ ràng).

## 1. Files chạm vào
| File | Action |
|---|---|
| package.json | CREATE |
| tsconfig.json | CREATE |
| tsconfig.build.json | CREATE |
| nest-cli.json | CREATE |
| .gitignore | CREATE |
| .env.example | CREATE |
| README.md | CREATE |
| src/config/env.validation.ts | CREATE |
| src/app.module.ts | CREATE |
| src/main.ts | CREATE |

## 2. Nội dung file

### package.json
```json
{
  "name": "discord-sheets-bot",
  "version": "0.1.0",
  "description": "NestJS bot that logs Discord messages from a fixed channel into Google Sheets",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "discord.js": "^14.16.0",
    "google-auth-library": "^9.14.0",
    "google-spreadsheet": "^4.1.4",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### tsconfig.build.json
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

### nest-cli.json
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

### .gitignore
```
node_modules/
dist/
.env
*.log
```

### .env.example
```
# Discord
DISCORD_BOT_TOKEN=your-bot-token-here
DISCORD_CHANNEL_ID=123456789012345678

# Google Sheets
GOOGLE_SHEET_ID=your-google-sheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@your-project.iam.gserviceaccount.com
# Paste the private key with literal \n for newlines, wrapped in double quotes
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

### src/config/env.validation.ts
```typescript
import { plainToInstance } from 'class-transformer';
import { IsString, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsString()
  DISCORD_BOT_TOKEN!: string;

  @IsString()
  DISCORD_CHANNEL_ID!: string;

  @IsString()
  GOOGLE_SHEET_ID!: string;

  @IsString()
  GOOGLE_SERVICE_ACCOUNT_EMAIL!: string;

  @IsString()
  GOOGLE_PRIVATE_KEY!: string;
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
```

### src/app.module.ts
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
})
export class AppModule {}
```

### src/main.ts
```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  await app.init();
  Logger.log('App started', 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
```

## 3. Encapsulation / wiring notes
- `ConfigModule` để `isGlobal: true` → SheetsService/DiscordService inject `ConfigService` không cần import lại.
- `main.ts` dùng `app.init()` (không `listen`) vì chưa cần HTTP port; SheetsModule/DiscordModule sẽ thêm ở phase sau qua `app.module.ts` imports.
- Chưa tạo HTTP server listen — bot là worker. (Nếu phase sau cần health endpoint sẽ đổi sang `app.listen`.)

## 4. Acceptance criteria
- [ ] `npm install` chạy xong không lỗi.
- [ ] `npm run typecheck` (tsc --noEmit) pass.
- [ ] Tạo `.env` từ `.env.example` với giá trị giả → `npm run start:dev` boot, log `App started`, không crash.
- [ ] Xóa 1 biến trong `.env` → boot fail với message `Invalid environment variables`.

## 5. Out of scope (cho phase này)
- Không tạo Discord client / Sheets service (phase 02, 03).
- Không có listener nào.

## 6. Commit message dự kiến
```
chore(scaffold): bootstrap NestJS app with validated env config

Tạo project NestJS v11 (package.json, tsconfig, nest-cli) cho discord-sheets-bot.
Thêm ConfigModule global với validateEnv (class-validator) bắt buộc các biến
DISCORD_*/GOOGLE_* khi boot. main.ts khởi tạo app dạng worker (app.init, no listen).
```
