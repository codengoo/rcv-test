# Phase 05 — Web UI: note, trạng thái, điểm + ReviewView (sửa realtime)

**Goal:** Trang web hiển thị note tĩnh + trạng thái + điểm thực; có chế độ sửa cho giám thị (URL `?review_code=NNNNNN`): toggle đúng/sai từng câu + ô điểm lẻ, tổng điểm tính realtime, nút lưu → confirmed.

## 1. Files chạm vào
| File | Action |
|---|---|
| web/src/api.ts | MODIFY (thêm getReview, saveReview, types) |
| web/src/App.tsx | MODIFY (parse ?review_code → render ReviewView) |
| web/src/components/ReviewView.tsx | CREATE |
| web/src/components/ResultDetailView.tsx | MODIFY (note + status badge + điểm + điểm mỗi câu) |

> Re-read các file thật ở đầu phase (App.tsx, api.ts, ResultDetailView.tsx,
> PasswordModal.tsx) để khớp style/CSS hiện có trước khi sửa.

## 2. api.ts
Thêm types + 2 hàm:
```ts
export interface ReviewQuestion {
  id: string; type: string; question: string; options: string[];
  studentAnswer: string; correctAnswer: string; isCorrect: boolean;
  earnedPoints: number; explanation: string;
}
export interface ReviewDetail {
  id: string; status: 'auto_graded' | 'confirmed';
  fullName: string; className: string; examCode: string;
  totalScore: number; maxScore: number; scoreText: string; note: string;
  images: { url: string }[]; questions: ReviewQuestion[];
}
export async function getReview(code: string): Promise<ReviewDetail> {
  const r = await fetch(`/api/review/${encodeURIComponent(code)}`);
  if (!r.ok) throw new Error(r.status === 404 ? 'notfound' : 'network');
  return r.json();
}
export async function saveReview(
  code: string,
  questions: { id: string; isCorrect: boolean; earnedPoints: number }[],
): Promise<ReviewDetail> {
  const r = await fetch(`/api/review/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions }),
  });
  if (!r.ok) throw new Error('network');
  return r.json();
}
```

## 3. App.tsx
- Đọc thêm query `review_code` (giống cách đang đọc `result_id`).
- Nếu có `review_code`: bỏ qua list/modal, fetch `getReview(code)` và render `<ReviewView code detail />` (full màn). Lỗi notfound → thông báo "Link sửa không hợp lệ".

## 4. ReviewView.tsx (MỚI)
- Props: `code: string`, `initial: ReviewDetail`.
- State: `questions` (local editable copy), `saving`, `saved`, `status`.
- Header: tên, lớp, mã đề, **status badge** (🟡 Đã chấm tự động / 🟢 Đã xác nhận bởi cán bộ chấm thi), **tổng điểm realtime** = `formatScore(sum earnedPoints)` + " điểm".
- Ảnh bài làm: tái dùng lightbox như ResultDetailView (đọc lại để copy cách dùng).
- Mỗi câu 1 thẻ:
  - Hiện đề/đáp án thí sinh/đáp án đúng/giải thích.
  - Toggle Đúng/Sai: bấm "Đúng" → set isCorrect=true, earnedPoints=1; "Sai" → isCorrect=false, earnedPoints=0.
  - Ô nhập điểm lẻ (number, step 0.05, min 0, max 1): đổi earnedPoints; nếu earnedPoints≥1 thì isCorrect=true, =0 thì false (giữa giữ isCorrect hiện tại nhưng không full). Hữu ích cho câu tự luận.
- Tổng điểm = sum(earnedPoints) làm tròn 2dp, cập nhật mỗi thay đổi.
- Nút "Lưu xác nhận" → `saveReview(code, questions.map(...))` → cập nhật state từ kết quả trả về (status confirmed, scoreText). Hiện toast/label "Đã lưu".
- Helper format điểm (copy nhỏ): `Number((Math.round(n*100)/100).toFixed(2)).toString()`.

## 5. ResultDetailView.tsx
- Thêm dòng note tĩnh (luôn hiển thị):
  > Bài thi được chấm tự động bởi `RCV exam` và được chấm lại bởi cán bộ chấm thi.
- Thêm **status badge** từ `detail.status` (cần api.ts ResultDetail có status — thêm field; đọc lại type hiện tại của detail).
- Hiển thị **điểm thực** `detail.scoreText + ' điểm'` (cạnh hoặc thay cho score "X/Y"); mỗi câu hiện điểm `earnedPoints` nếu < 1 (vd "0.67đ").

## 6. Encapsulation / wiring notes
- FE gọi qua `/api/...` (Vite proxy dev, same-origin prod) — không hardcode domain.
- Không thêm router lib; vẫn parse `window.location.search` như hiện tại.
- ReviewView không cần password (code trong URL đã là quyền truy cập).

## 7. Acceptance criteria
- [ ] `cd web && npx tsc --noEmit` (hoặc `npm run build`) pass.
- [ ] `npm run build` (web) tạo dist không lỗi.
- [ ] (Manual) Mở `?review_code=NNNNNN` → ReviewView; toggle/nhập điểm → tổng đổi realtime; Lưu → badge chuyển "Đã xác nhận".
- [ ] (Manual) Mở `?result_id=...` + unlock → thấy note + status badge + điểm thực; flow cũ không vỡ.

## 8. Out of scope
- Không đổi danh sách công khai.
- Không thêm i18n/responsive nâng cao ngoài style sẵn có.

## 9. Commit message dự kiến
```
feat(web): trang sửa kết quả cho giám thị + note/trạng thái/điểm

ReviewView (?review_code=NNNNNN): toggle đúng/sai + ô điểm lẻ từng câu, tổng
điểm realtime, lưu xác nhận → status confirmed. ResultDetailView thêm note
"chấm tự động bởi RCV exam + chấm lại bởi cán bộ chấm thi", status badge và
điểm thực. api.ts thêm getReview/saveReview.
```
