# Phase 01 — Deps + Env (GEMINI_API_KEY)

**Goal:** Sau phase này, project có sẵn các package LangChain/Gemini/zod đã cài, và biến `GEMINI_API_KEY` được validate khi boot + có trong `.env.example`. App vẫn boot được (giả định key đã điền trong `.env`).

## 1. Files chạm vào
| File | Action |
|---|---|
| package.json | MODIFY (thêm 3 dependencies) |
| src/config/env.validation.ts | MODIFY (thêm field GEMINI_API_KEY) |
| .env.example | MODIFY (thêm GEMINI_API_KEY) |
| .env | MODIFY (thêm GEMINI_API_KEY=... — user điền key thật; nếu chưa có thì để placeholder) |

## 2. package.json — thêm dependencies
Thêm vào khối `dependencies` (giữ thứ tự alphabet hợp lý):
```json
"@langchain/core": "^0.3.0",
"@langchain/google-genai": "^0.2.0",
"zod": "^3.23.8",
```
Cài bằng:
```
npm install @langchain/google-genai@^0.2.0 @langchain/core@^0.3.0 zod@^3.23.8
```
(npm sẽ tự ghi version chính xác đã resolve vào package.json + lock.)

## 3. src/config/env.validation.ts — thêm field
Trong class `EnvironmentVariables`, thêm (required):
```typescript
  @IsString()
  GEMINI_API_KEY!: string;
```
Đặt sau `DISCORD_CHANNEL_ID` hoặc cuối class — không đổi logic `validateEnv`.

## 4. .env.example — thêm khối Gemini
Thêm cuối file:
```
# Gemini (AI trích xuất hóa đơn)
GEMINI_API_KEY=your-gemini-api-key
```

## 5. .env — thêm key thật
Thêm dòng `GEMINI_API_KEY=<key thật của user>`. Nếu user chưa cung cấp key trong phiên này → để `GEMINI_API_KEY=PLACEHOLDER` và NHẮC user thay (app sẽ boot nhưng gọi Gemini sẽ fail tới khi thay key thật).

## 6. Encapsulation / wiring notes
- Không tạo module mới ở phase này.
- `GEMINI_API_KEY` để required: nếu thiếu, `validateEnv` ném lỗi rõ ràng khi boot — đúng ý "lộ misconfig sớm".

## 7. Acceptance criteria
- [ ] `npm install` chạy xong, 3 package xuất hiện trong `package.json` + `package-lock.json`.
- [ ] `node -e "require('@langchain/google-genai')"` không lỗi module-not-found.
- [ ] `npm run typecheck` pass.
- [ ] `npm run build` pass.
- [ ] Với `.env` có đủ biến (gồm `GEMINI_API_KEY`), `npm run start:dev` boot không lỗi env-validation; nếu xóa thử `GEMINI_API_KEY` → boot fail với message "Invalid environment variables".

## 8. Out of scope (phase này)
- Không viết GeminiService (phase 02).
- Không chạm DiscordService (phase 03).

## 9. Commit message dự kiến
```
chore(gemini): add LangChain/Gemini deps + GEMINI_API_KEY env

Thêm @langchain/google-genai, @langchain/core, zod cho luồng trích xuất
hóa đơn (task 2). Validate GEMINI_API_KEY (required) trong env.validation
và .env.example. Chưa wire vào runtime — chỉ chuẩn bị nền.
```
