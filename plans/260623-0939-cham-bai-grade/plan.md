# Bot chấm bài thi từ ảnh → Google Sheet

**Date:** 2026-06-23 09:39 (SEAST)
**Scope:** src/discord, src/grade (mới), src/config, src/shared/gemini (đọc), database (đọc), README/.env.example
**Trigger:** Bỏ luồng "lắng nghe tin nhắn + trích hóa đơn". Thay bằng một slash command `/cham-bai`: giám khảo upload ảnh bài làm của thí sinh + thông tin thí sinh; Gemini đọc bài làm, tự nhận mã đề, đối chiếu đáp án trong `database/*.md`, tính điểm; bot ghi 1 dòng vào Google Sheet và reply kết quả.

## 1. Goal
Khi xong, bot KHÔNG còn xử lý `messageCreate` (không trích hóa đơn nữa). Có 2 slash command:
- `/add-quiz` (giữ nguyên) — tạo file đáp án `.md` trong `database/`.
- `/cham-bai` (mới) — nhận ảnh bài làm + `hoten`, `bome`, `sdt`, `lop`. Gemini đọc ảnh, tự đọc **Mã đề** ghi trên bài, khớp với đáp án trong `database/`, chấm theo chỉ dẫn chấm (mỗi câu 1 điểm). Bot append 1 dòng `[Họ tên, Bố mẹ, SĐT bố mẹ, Lớp, Điểm (vd "9/12"), Link ảnh CDN]` vào Google Sheet, rồi reply embed kết quả.

## 2. Quyết định đã chốt (từ Q&A 1 vòng)
| Câu hỏi | Lựa chọn |
|---|---|
| Chọn đề chấm theo cách nào | **AI tự đọc "Mã đề" trên ảnh**; code nạp toàn bộ `database/*.md` vào prompt, Gemini chọn đề khớp mã đề và chấm |
| Thang điểm | **Số câu đúng / tổng**, ghi vào sheet dạng chuỗi `"9/12"` (mỗi câu 1 điểm theo chỉ dẫn chấm) |
| Số ảnh mỗi bài làm | **Nhiều ảnh**: option `file` (bắt buộc) + `file2`..`file5` (tùy chọn), Gemini đọc tất cả |
| Giữ `/add-quiz`? | **Giữ** — đây là nguồn tạo file đáp án `.md` |
| Luồng hóa đơn + `messageCreate` | **Gỡ hẳn**: handler, `tryExtractReceipt`, `receipt.schema.ts`, dedup, intents đọc message |
| `DISCORD_CHANNEL_ID` | **Gỡ** khỏi env (không còn listener theo channel) |
| Cột sheet (A→F) | A: Họ tên thí sinh, B: Bố mẹ, C: SĐT bố mẹ, D: Lớp, E: Điểm, F: Link ảnh |
| Link ảnh | Dùng `attachment.url` (cdn.discordapp.com, có chữ ký/hết hạn); nhiều ảnh nối bằng `\n` |

## 3. Luồng `/cham-bai` (không có state lưu trữ — đồng bộ trong 1 interaction)
```
/cham-bai (file[,file2..5], hoten, bome, sdt, lop)
   │ deferReply (chấm AI > 3s)
   ├─ gom attachment image/* → tải về → base64[]
   │     └─ 0 ảnh image/* → editReply lỗi, dừng
   ├─ GradeService.grade(images[])
   │     ├─ loadAnswerKeys(): đọc database/*.md → [{file, maDe, title, content}]
   │     │     └─ rỗng → throw "chưa có đáp án, dùng /add-quiz"
   │     ├─ ghép toàn bộ đáp án vào 1 prompt + các imagePart
   │     └─ Gemini structured → {maDe, totalQuestions, correctCount, perQuestion[], note}
   ├─ score = `${correctCount}/${totalQuestions}`
   ├─ imageLinks = images.url.join("\n")
   ├─ Sheets.appendRow([hoten, bome, sdt, lop, score, imageLinks])
   └─ editReply embed (mã đề, điểm, file đáp án khớp, note)
   (lỗi bất kỳ → editReply embed đỏ, không crash)
```

## 4. Schema (không có DB SQL — chỉ schema output AI)
`src/grade/grade.schema.ts` — zod, **KHÔNG** `.nullable()/.optional()` (Gemini response_schema reject):
```ts
gradeResultSchema = z.object({
  maDe: z.string(),                 // mã đề đọc từ ảnh, "" nếu không thấy
  totalQuestions: z.number(),       // tổng số câu của đề khớp
  correctCount: z.number(),         // số câu đúng
  perQuestion: z.array(z.object({
    cau: z.number(),
    dapAnChon: z.string(),          // "" nếu bỏ trống
    dapAnDung: z.string(),
    dung: z.boolean(),
  })),
  note: z.string(),                 // ghi chú (ảnh mờ, không thấy mã đề...), "" nếu không
})
```

## 5. Cột Google Sheet (A→F, mỗi bài làm 1 dòng)
| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Họ tên thí sinh | Bố mẹ | SĐT bố mẹ | Lớp | Điểm (vd `9/12`) | Link ảnh (nối `\n`) |

## 6. Phase breakdown
| Phase | File | Mục tiêu | Phụ thuộc |
|---|---|---|---|
| 01 | phase-01-grade-domain.md | Tạo module `grade/` (schema + service đọc đáp án + chấm qua Gemini) | — |
| 02 | phase-02-discord-rework.md | Gỡ messageCreate/hóa đơn; thêm `/cham-bai`; wire GradeService + ghi sheet | 01 |
| 03 | phase-03-config-docs.md | Gỡ `DISCORD_CHANNEL_ID` khỏi env; cập nhật `.env.example` + README | 02 |

## 7. Phạm vi (In / Out)
**In scope:**
- CREATE `src/grade/grade.schema.ts`, `src/grade/grade.service.ts`, `src/grade/grade.module.ts`
- MODIFY `src/discord/discord.service.ts` (gỡ listener/hóa đơn, thêm `/cham-bai`)
- DELETE `src/discord/receipt.schema.ts`
- MODIFY `src/discord/discord.module.ts` (import GradeModule, bỏ GeminiModule khỏi import trực tiếp)
- MODIFY `src/config/env.validation.ts` (bỏ `DISCORD_CHANNEL_ID`)
- MODIFY `.env.example`, `README.md`

**Out of scope:**
- Không đổi `shared/gemini`, `shared/google-sheets` (dùng nguyên).
- Không re-host ảnh / xử lý URL discord hết hạn.
- Không thêm header row tự động vào sheet (giám khảo tự đặt header).
- Không ghi kết quả chấm chi tiết từng câu vào sheet (chỉ điểm tổng); chi tiết chỉ ở embed reply.
- Không thay đổi `/add-quiz`.
- Không thêm test tự động.

## 8. Risks
- **Prompt lớn nếu có nhiều đề trong `database/`**: nạp tất cả đáp án vào 1 call. Hiện chỉ 1 đề → chấp nhận; nếu sau này nhiều đề, tách 2 bước (đọc mã đề trước, nạp 1 đề). Ghi chú trong service.
- **AI đọc sai mã đề / chấm sai chữ viết tay**: chấp nhận — bài làm trắc nghiệm rõ ràng; `note` + `perQuestion` ở embed để giám khảo soát lại.
- **URL ảnh discord hết hạn**: `attachment.url` có chữ ký hết hạn theo thời gian. Chấp nhận (yêu cầu chỉ là "cdn discord url"); nếu cần vĩnh viễn → re-host (out of scope).
- **`perQuestion` mảng object có thể làm structured output Gemini nặng/đôi khi lỗi**: đã có retry trong `GeminiService`; nếu vẫn lỗi → embed báo lỗi, không crash.
- **Bỏ intent đọc message** (`GuildMessages`/`MessageContent`): nếu sau này cần đọc message lại phải bật lại intent + Message Content Intent trong Developer Portal. Ghi chú trong README.
