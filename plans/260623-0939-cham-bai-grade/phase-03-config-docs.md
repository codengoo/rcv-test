# Phase 03 — Config + docs cleanup

**Goal:** Gỡ biến `DISCORD_CHANNEL_ID` (không còn listener theo channel). Cập nhật `.env.example` và `README.md` cho đúng luồng mới (2 slash command, không còn hóa đơn/lắng nghe tin nhắn).

## 1. Files chạm vào
| File | Action |
|---|---|
| src/config/env.validation.ts | MODIFY |
| .env.example | MODIFY |
| README.md | MODIFY |

## 2. src/config/env.validation.ts
Gỡ block `DISCORD_CHANNEL_ID`:
```ts
// BỎ:
  @IsString()
  DISCORD_CHANNEL_ID!: string;
```
Giữ lại: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `GOOGLE_SHEET_ID`, `GEMINI_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_FILE?`. Sửa comment `GEMINI_API_KEY` từ "trích xuất hóa đơn (task 2)" → "đọc/chấm bài làm + giải đề".

## 3. .env.example (mới)
```
# Discord
DISCORD_BOT_TOKEN=your-bot-token-here
# ID server để đăng ký slash command /add-quiz, /cham-bai (Developer Mode → chuột phải server → Copy Server ID)
DISCORD_GUILD_ID=123456789012345678

# Google Sheets
GOOGLE_SHEET_ID=your-google-sheet-id
# Đường dẫn tới file service account JSON. Bỏ trống = dùng ./service-account.json
# GOOGLE_SERVICE_ACCOUNT_FILE=service-account.json

# Gemini (AI đọc/chấm bài làm + giải đề) — lấy key tại https://aistudio.google.com/apikey
GEMINI_API_KEY=your-gemini-api-key
```
> Xóa dòng `DISCORD_CHANNEL_ID`.

## 4. README.md — các thay đổi
- **Tiêu đề + mô tả đầu**: đổi từ "lắng nghe tin nhắn → mỗi tin 1 dòng" sang "bot chấm bài: 2 slash command `/add-quiz` (tạo đáp án) + `/cham-bai` (chấm bài làm từ ảnh, ghi điểm vào Google Sheet)".
- **Kiến trúc**: bỏ sơ đồ `messageCreate`; mô tả `src/grade/` (đọc đáp án `database/*.md`, Gemini đọc ảnh + chấm). Bỏ mô tả listener/dedup ở `src/discord/`.
- **Bảng cột sheet**: thay bảng A–K hóa đơn bằng bảng mới:

  | A | B | C | D | E | F |
  |---|---|---|---|---|---|
  | Họ tên thí sinh | Bố mẹ | SĐT bố mẹ | Lớp | Điểm (vd `9/12`) | Link ảnh (cdn discord, nối `\n`) |

- **Bảng `.env`**: bỏ dòng `DISCORD_CHANNEL_ID`; sửa mô tả `GEMINI_API_KEY`.
- **Thiết lập Discord**: bỏ bước "bật Message Content Intent" (không cần nữa) + bỏ "Copy channel ID"; nêu rõ chỉ cần scope `bot` + `applications.commands`. Có thể thêm câu: "Có thể TẮT Message Content Intent vì bot chỉ dùng slash command."
- **Bỏ hẳn mục** "Trích xuất hóa đơn bằng Gemini (task 2)" và mục "Hành vi & giới hạn" phần nói về channel/dedup/bot message.
- **Thêm mục** "Chấm bài bằng `/cham-bai`":
  1. Trước tiên dùng `/add-quiz` để tạo đáp án `.md` trong `database/` (có ghi "Mã đề").
  2. Gõ `/cham-bai`, đính `file` (ảnh bài làm trang 1) + `hoten`, `bome`, `sdt`, `lop`; thêm `file2..file5` nếu nhiều trang.
  3. Gemini đọc ảnh, tự nhận **Mã đề** ghi trên bài, đối chiếu đáp án, chấm mỗi câu 1 điểm.
  4. Bot append 1 dòng `[Họ tên, Bố mẹ, SĐT, Lớp, Điểm, Link ảnh]` vào Sheet và reply embed (điểm, mã đề, ghi chú).
  - Giới hạn: ảnh phải `image/*`; điểm dạng `số câu đúng/tổng`; link ảnh dùng URL discord (có thể hết hạn theo thời gian).
- **Scripts**: giữ nguyên.

## 5. Encapsulation / wiring notes
- Không còn code nào đọc `DISCORD_CHANNEL_ID` sau Phase 02 (đã gỡ ở `discord.service.ts`) → an toàn để bỏ khỏi validation. `validateEnv` sẽ KHÔNG còn bắt buộc biến này.

## 6. Acceptance criteria
- [ ] `grep -rn "DISCORD_CHANNEL_ID" src` không còn kết quả.
- [ ] `npm run build` pass; server boot với `.env` không có `DISCORD_CHANNEL_ID` → không lỗi validation.
- [ ] README không còn nhắc "lắng nghe tin nhắn"/"hóa đơn"; có mục `/cham-bai` + bảng cột A–F mới.
- [ ] `.env.example` không còn `DISCORD_CHANNEL_ID`.

## 7. Out of scope (phase này)
- Không đổi logic code (chỉ env + docs).

## 8. Commit message dự kiến
```
chore(config): drop DISCORD_CHANNEL_ID, update env example and README

Bot no longer listens to a channel — remove the now-unused
DISCORD_CHANNEL_ID from env validation and .env.example. Rewrite README
for the /add-quiz + /cham-bai flow and the new sheet columns
(họ tên, bố mẹ, sđt, lớp, điểm, link ảnh).
```
