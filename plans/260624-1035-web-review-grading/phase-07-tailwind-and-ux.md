# Phase 07 — Tailwind hoá web + gộp link đề + per-question edit + confirm

**Goal:** Toàn bộ CSS web dùng TailwindCSS (bỏ styles.css). /add-quiz chỉ còn 1
link (code 6 số) vừa xem vừa sửa đề. Trong sửa đề & sửa bài làm: mỗi câu mặc
định ở chế độ xem, có nút "Sửa" riêng từng câu; nút "Cập nhật" ở cuối; có popup
xác nhận trước khi lưu.

## Quyết định
| Câu hỏi | Lựa chọn |
|---|---|
| CSS | TailwindCSS v4 (@tailwindcss/vite), bỏ styles.css |
| Link đề | Gộp xem+sửa thành 1 link `?exam_edit=NNNNNN` |
| Edit từng câu | Mặc định view; nút "Sửa" mở edit CHỈ câu đó (không đổi cả đề) |
| Nút lưu | "Cập nhật" ở cuối trang |
| Confirm | Popup xác nhận trước khi lưu (cả review bài làm & sửa đề) |

## Files
| File | Action |
|---|---|
| web/vite.config.ts | MODIFY (plugin tailwind) |
| web/src/index.css | CREATE (@import tailwindcss + @theme màu) |
| web/src/styles.css | DELETE |
| web/src/main.tsx | MODIFY (import index.css) |
| web/src/ui.ts | CREATE (class dùng chung: btn, card…) |
| web/src/components/ConfirmModal.tsx | CREATE (popup xác nhận, Tailwind) |
| web/src/App.tsx | MODIFY (Tailwind) |
| web/src/components/ResultList.tsx | MODIFY (Tailwind) |
| web/src/components/PasswordModal.tsx | MODIFY (Tailwind) |
| web/src/components/ResultDetailView.tsx | MODIFY (Tailwind) |
| web/src/components/ReviewView.tsx | MODIFY (Tailwind + per-question edit + confirm) |
| web/src/components/ExamView.tsx | MODIFY (Tailwind) |
| web/src/components/ExamEditView.tsx | MODIFY (Tailwind + per-question edit + confirm) |
| src/discord/discord.service.ts | MODIFY (embed /add-quiz còn 1 link) |

## Theme màu (giữ palette tối hiện tại) → token Tailwind
bg #0f172a · surface #1e293b · surface2 #334155 · text #e2e8f0 · muted #94a3b8 ·
primary #38bdf8 · correct #22c55e · wrong #ef4444 · border #334155.

## Per-question edit (ReviewView & ExamEditView)
- State `editing: Set<id>`; nút "✏️ Sửa"/"✓ Xong" mỗi card toggle id.
- View: hiển thị giá trị hiện tại (review: đáp án TS + đúng/sai + điểm; đề: đáp án + lời giải).
- Edit: review = toggle đúng/sai + ô điểm lẻ; đề = input đáp án + textarea lời giải.
- Giá trị giữ trong state dù card thu gọn. Tổng điểm (review) vẫn tính realtime.
- Nút "Cập nhật/Lưu" cuối trang → mở ConfirmModal → xác nhận → gọi API.

## Acceptance
- [ ] `npm run build` web pass; không còn import styles.css; styles.css đã xóa.
- [ ] Backend `tsc` pass (embed đổi link).
- [ ] (Manual) Giao diện giữ nguyên bố cục tối; mỗi câu có nút Sửa; lưu hiện popup xác nhận.

## Out of scope
- Không đổi logic API/score. Không thêm thư viện UI ngoài Tailwind.
