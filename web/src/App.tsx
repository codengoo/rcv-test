import { useEffect, useState } from 'react';
import {
  ExamDetail,
  fetchResults,
  getExam,
  getExamForEdit,
  getReview,
  ResultDetail,
  ResultListItem,
  ReviewDetail,
  ReviewError,
} from './api';
import { ResultList } from './components/ResultList';
import { PasswordModal } from './components/PasswordModal';
import { ResultDetailView } from './components/ResultDetailView';
import { ReviewView } from './components/ReviewView';
import { ExamView } from './components/ExamView';
import { ExamEditView } from './components/ExamEditView';

/** Bỏ dấu + thường hóa để tìm tên tiếng Việt không phân biệt dấu. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

export default function App() {
  const [items, setItems] = useState<ResultListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');

  // Item đang mở modal nhập mật khẩu (null = không mở).
  const [modalItem, setModalItem] = useState<ResultListItem | null>(null);
  // Chi tiết đã unlock (null = đang ở màn danh sách).
  const [detail, setDetail] = useState<ResultDetail | null>(null);

  const params = new URLSearchParams(window.location.search);
  // ?result_id=... → mở sẵn modal nhập mật khẩu cho kết quả đó.
  const resultId = params.get('result_id');
  // ?review_code=NNNNNN → chế độ giám thị sửa kết quả (code trong URL là quyền).
  const reviewCode = params.get('review_code');
  // ?exam_code=A02 → xem đề (đáp án + giải thích).
  const examCode = params.get('exam_code');
  // ?exam_edit=NNNNNN → cán bộ sửa đáp án/giải thích của đề (code trong URL).
  const examEditCode = params.get('exam_edit');
  // Có route riêng (review/exam) → bỏ qua màn danh sách kết quả.
  const standalone = !!(reviewCode || examCode || examEditCode);

  // Trạng thái cho luồng giám thị sửa (chỉ dùng khi có review_code).
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [reviewLoading, setReviewLoading] = useState(!!reviewCode);
  const [reviewError, setReviewError] = useState('');

  // Trạng thái cho luồng xem/sửa đề.
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [examLoading, setExamLoading] = useState(!!(examCode || examEditCode));
  const [examError, setExamError] = useState('');

  useEffect(() => {
    if (standalone) return; // route riêng → bỏ qua tải danh sách công khai
    fetchResults()
      .then((list) => {
        setItems(list);
        if (resultId) {
          const found = list.find((it) => it.id === resultId);
          setModalItem(
            found ?? {
              id: resultId,
              fullName: '',
              className: '',
              score: '',
              examCode: '',
              createdAt: '',
            },
          );
        }
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [resultId, standalone]);

  useEffect(() => {
    if (!reviewCode) return;
    getReview(reviewCode)
      .then(setReview)
      .catch((err: unknown) =>
        setReviewError(
          err instanceof ReviewError && err.reason === 'notfound'
            ? 'Link sửa không hợp lệ hoặc bài thi không tồn tại.'
            : 'Không tải được bài thi, vui lòng thử lại.',
        ),
      )
      .finally(() => setReviewLoading(false));
  }, [reviewCode]);

  useEffect(() => {
    if (!examCode && !examEditCode) return;
    const load = examEditCode
      ? getExamForEdit(examEditCode)
      : getExam(examCode as string);
    load
      .then(setExam)
      .catch((err: unknown) =>
        setExamError(
          err instanceof ReviewError && err.reason === 'notfound'
            ? 'Link đề không hợp lệ hoặc đề không tồn tại.'
            : 'Không tải được đề, vui lòng thử lại.',
        ),
      )
      .finally(() => setExamLoading(false));
  }, [examCode, examEditCode]);

  // Luồng giám thị sửa kết quả: ưu tiên trước màn danh sách/chi tiết.
  if (reviewCode) {
    if (reviewLoading) return <p className="state">Đang tải bài thi…</p>;
    if (reviewError)
      return <p className="state state--error">{reviewError}</p>;
    if (review) return <ReviewView code={reviewCode} initial={review} />;
    return null;
  }

  // Luồng xem/sửa đề.
  if (examCode || examEditCode) {
    if (examLoading) return <p className="state">Đang tải đề…</p>;
    if (examError) return <p className="state state--error">{examError}</p>;
    if (exam && examEditCode)
      return <ExamEditView code={examEditCode} initial={exam} />;
    if (exam) return <ExamView detail={exam} />;
    return null;
  }

  const filtered = query.trim()
    ? items.filter((it) => normalize(it.fullName).includes(normalize(query)))
    : items;

  if (detail) {
    return (
      <ResultDetailView detail={detail} onBack={() => setDetail(null)} />
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <h1>Tra cứu kết quả thi</h1>
        <p className="page__subtitle">
          Chọn thí sinh và nhập mật khẩu để xem chi tiết bài làm.
        </p>
      </header>

      {loading && <p className="state">Đang tải danh sách…</p>}
      {loadError && <p className="state state--error">{loadError}</p>}
      {!loading && !loadError && items.length === 0 && (
        <p className="state">Chưa có kết quả nào.</p>
      )}

      {!loading && !loadError && items.length > 0 && (
        <>
          <input
            className="search"
            type="search"
            placeholder="Tìm theo tên thí sinh…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length > 0 ? (
            <ResultList items={filtered} onSelect={setModalItem} />
          ) : (
            <p className="state">Không tìm thấy thí sinh nào.</p>
          )}
        </>
      )}

      {modalItem && (
        <PasswordModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          onUnlocked={(d) => {
            setModalItem(null);
            setDetail(d);
          }}
        />
      )}
    </div>
  );
}
