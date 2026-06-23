# Phase 04 — HTTP server + REST API (list + unlock)

**Goal:** App mở HTTP server, phục vụ REST API tra cứu: danh sách công khai + unlock bằng accessCode (rate-limited, check server-side). Serve React build tĩnh.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/main.ts | MODIFY (`app.listen(PORT)`; global prefix? KHÔNG — chỉ controller dùng @Controller('api/...'); bật CORS dev; ServeStatic) |
| src/results/results.controller.ts | CREATE (GET /api/results, POST /api/results/:id/unlock) |
| src/results/results.module.ts | CREATE (import SubmissionModule) |
| src/app.module.ts | MODIFY (import ResultsModule, ThrottlerModule, ServeStaticModule cho web/dist) |
| package.json | MODIFY (deps: @nestjs/throttler, @nestjs/serve-static) |

## 2. Ý chính
- `main.ts`: `await app.listen(process.env.PORT ?? 3000)` thay `app.init()`. Discord bot vẫn init trong module nên không ảnh hưởng. Bật `app.enableCors()` (dev: cho phép 5173).
- `GET /api/results` → SubmissionService.list() map sang `ResultListItem` (id, fullName, className, score, examCode, createdAt) — KHÔNG kèm phone/ảnh/đáp án.
- `POST /api/results/:id/unlock` body `{ code }`:
  - load submission theo id; so `code === accessCode`; sai → 401.
  - đúng → trả `ResultDetail`: build `images[].url` từ fileId (`https://drive.google.com/thumbnail?id=<id>&sz=w2000`), kèm questions đầy đủ.
- `@nestjs/throttler` giới hạn `/unlock` (vd 10 req/phút/IP).
- `ServeStaticModule.forRoot({ rootPath: web/dist, exclude: ['/api*'] })` để phục vụ FE prod (phase 05 build ra dist).

## 3. Encapsulation / wiring notes
- Controller chỉ gọi SubmissionService; không truy cập Model trực tiếp.
- Dựng URL ảnh ở backend (1 helper) — FE không tự ghép Drive URL.

## 4. Acceptance criteria
- [ ] `npm run build` + `npm run start` → server listen PORT.
- [ ] `GET /api/results` trả JSON list (không có phone/đáp án).
- [ ] `POST /api/results/:id/unlock` code sai → 401; code đúng (`000000`) → 200 + detail đầy đủ (images.url + questions).
- [ ] Spam `/unlock` > ngưỡng → 429 (throttler).
- [ ] (Sau phase 05) truy cập `/` trả React app.

## 5. Out of scope
- React UI (phase 05). Admin login.

## 6. Commit message dự kiến
```
feat(results): expose HTTP REST API for result lookup

Switch main.ts to app.listen and add ResultsController: public GET
/api/results (minimal fields) and POST /api/results/:id/unlock that checks
accessCode server-side (throttled) and returns full detail with Drive image
URLs. Serve web/dist via ServeStaticModule.
```
