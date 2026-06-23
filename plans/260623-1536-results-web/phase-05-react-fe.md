# Phase 05 — React FE (Vite + TS): list → mật khẩu → chi tiết + zoom ảnh

**Goal:** Trang web hoàn chỉnh tại `web/`: danh sách thí sinh → click → modal nhập mật khẩu → trang chi tiết (ảnh 2 trang zoom/fullscreen + bảng câu hỏi/đáp án/giải thích). Build ra tĩnh, Nest serve.

## 1. Files chạm vào
| File | Action |
|---|---|
| web/ (Vite scaffold) | CREATE (package.json, vite.config.ts, tsconfig, index.html, src/) |
| web/src/App.tsx, api.ts, components/* | CREATE |
| package.json (root) | MODIFY (script `web:dev`, `web:build`; build FE trước nest build nếu cần) |
| .gitignore | MODIFY (web/node_modules, web/dist nếu không commit) |

## 2. Ý chính
- Scaffold: `npm create vite@latest web -- --template react-ts`. Vite proxy `/api` → `http://localhost:3000` cho dev.
- Màn 1 — List: `GET /api/results`, render bảng/card (tên, lớp, điểm). Click → mở modal mật khẩu.
- Modal mật khẩu: input 6 số → `POST /api/results/:id/unlock {code}`. 401 → báo sai; 429 → báo thử lại sau; 200 → sang chi tiết.
- Màn 2 — Detail: hiển thị thông tin + điểm; khu vực ảnh (images[].url) dùng **PhotoSwipe** (hoặc `yet-another-react-lightbox`) cho zoom/fullscreen; bảng từng câu: số câu, đề, đáp án HS (studentAnswer) vs đáp án đúng (correctAnswer) tô màu đúng/sai, giải thích (explanation).
- Build: `web:build` → `web/dist`; Nest ServeStatic (phase 04) phục vụ.

## 3. Encapsulation / wiring notes
- FE chỉ gọi 2 endpoint; KHÔNG tự ghép URL Drive (đã có `images[].url` từ API).
- accessCode chỉ gửi qua POST body, không lưu localStorage.

## 4. Acceptance criteria
- [ ] `npm run web:dev` (FE) + `npm run start` (API) → list hiển thị dữ liệu thật.
- [ ] Nhập sai mật khẩu → báo lỗi; đúng `000000` → vào chi tiết.
- [ ] Ảnh phóng to/thu nhỏ + fullscreen hoạt động (desktop + mobile pinch nếu PhotoSwipe).
- [ ] Bảng câu hỏi: câu đúng/sai phân biệt rõ + có giải thích.
- [ ] `npm run web:build` → `web/dist`; `npm run start` truy cập `/` ra app (prod cùng origin).

## 5. Out of scope
- PWA, i18n, theme. Pagination/search nâng cao (có thể thêm sau nếu nhiều bài).

## 6. Commit message dự kiến
```
feat(web): React result-lookup UI (list, password gate, detail+zoom)

Vite+React+TS app in web/: candidate list from /api/results, password
modal calling /unlock, and a detail view with PhotoSwipe image zoom/
fullscreen plus a per-question table (student vs correct answer +
explanation). Served as static build by the Nest backend.
```
