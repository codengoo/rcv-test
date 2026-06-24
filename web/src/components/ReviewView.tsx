import { useMemo, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import 'yet-another-react-lightbox/styles.css';
import { ReviewDetail, ReviewError, formatScore, saveReview } from '../api';
import { ConfirmModal } from './ConfirmModal';
import {
  badge,
  btnPrimary,
  btnSm,
  explanationBox,
  footerBar,
  optionsList,
  page,
  questionCard,
  sectionTitle,
} from '../ui';

interface Props {
  code: string;
  initial: ReviewDetail;
}

/** Trạng thái editable của 1 câu trong lúc giám thị sửa. */
interface EditQuestion {
  id: string;
  type: string;
  question: string;
  options: string[];
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  earnedPoints: number;
  explanation: string;
}

const NOTE =
  'Bài thi được chấm tự động bởi RCV exam và được chấm lại bởi cán bộ chấm thi.';

function statusLabel(status: string): string {
  return status === 'confirmed'
    ? '🟢 Đã xác nhận bởi cán bộ chấm thi'
    : '🟡 Đã chấm tự động';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toEdit(qs: ReviewDetail['questions']): EditQuestion[] {
  return qs.map((q) => ({
    id: q.id,
    type: q.type,
    question: q.question,
    options: q.options,
    studentAnswer: q.studentAnswer,
    correctAnswer: q.correctAnswer,
    isCorrect: q.isCorrect,
    earnedPoints: q.earnedPoints,
    explanation: q.explanation,
  }));
}

/**
 * Màn sửa kết quả cho giám thị (?review_code=NNNNNN). Mỗi câu mặc định ở chế độ
 * xem; bấm "Sửa" mở chỉnh sửa CHỈ câu đó (toggle đúng/sai + điểm lẻ). Tổng điểm
 * tính realtime; "Cập nhật" cuối trang mở popup xác nhận rồi mới lưu.
 */
export function ReviewView({ code, initial }: Props) {
  const [status, setStatus] = useState(initial.status);
  const [questions, setQuestions] = useState<EditQuestion[]>(
    toEdit(initial.questions),
  );
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const slides = initial.images.map((img) => ({ src: img.url }));

  const total = useMemo(
    () => questions.reduce((sum, q) => sum + q.earnedPoints, 0),
    [questions],
  );
  const maxScore = initial.maxScore || questions.length;

  function toggleEdit(id: string) {
    setEditing((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function update(id: string, patch: Partial<EditQuestion>) {
    setSaved(false);
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    );
  }

  function setCorrect(id: string, isCorrect: boolean) {
    update(id, { isCorrect, earnedPoints: isCorrect ? 1 : 0 });
  }

  function setPoints(id: string, raw: string) {
    const n = clamp01(parseFloat(raw));
    update(id, { earnedPoints: n, isCorrect: n >= 1 });
  }

  async function doSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await saveReview(
        code,
        questions.map((q) => ({
          id: q.id,
          isCorrect: q.isCorrect,
          earnedPoints: q.earnedPoints,
        })),
      );
      setStatus(updated.status);
      setQuestions(toEdit(updated.questions));
      setEditing(new Set());
      setSaved(true);
      setConfirming(false);
    } catch (err) {
      setError(
        err instanceof ReviewError && err.reason === 'notfound'
          ? 'Không tìm thấy bài thi (link sửa không hợp lệ).'
          : 'Lưu thất bại, vui lòng thử lại.',
      );
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={page}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">
          {initial.fullName || '(không tên)'}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-muted">
          <span>Lớp {initial.className || '-'}</span>
          <span>Mã đề {initial.examCode}</span>
          <span className="font-bold text-primary">
            Điểm: {formatScore(total)} / {maxScore}
          </span>
          <span className={badge}>{statusLabel(status)}</span>
        </div>
        <p className="mt-2 text-muted">{NOTE}</p>
        <p className="mt-2 text-muted">
          Mỗi câu hiển thị ở chế độ xem; bấm <strong>Sửa</strong> để chỉnh đúng/sai
          hoặc nhập điểm lẻ (0–1) cho câu tự luận, rồi bấm “Cập nhật”.
        </p>
      </header>

      {slides.length > 0 && (
        <section className="mb-8">
          <h2 className={sectionTitle}>Ảnh bài làm</h2>
          <div className="flex flex-wrap gap-3">
            {initial.images.map((img, i) => (
              <button
                key={i}
                type="button"
                className="h-55 w-40 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-surface"
                onClick={() => setLightboxIndex(i)}
              >
                <img
                  src={img.url}
                  alt={`Trang ${i + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
          <Lightbox
            open={lightboxIndex >= 0}
            index={Math.max(lightboxIndex, 0)}
            close={() => setLightboxIndex(-1)}
            slides={slides}
            plugins={[Zoom, Fullscreen]}
            zoom={{ maxZoomPixelRatio: 4 }}
          />
        </section>
      )}

      <section className="mb-8">
        <h2 className={sectionTitle}>Chấm từng câu</h2>
        <div className="flex flex-col gap-3.5">
          {questions.map((q) => {
            const isEditing = editing.has(q.id);
            return (
              <div
                key={q.id}
                className={`${questionCard} ${q.isCorrect ? 'border-l-correct' : 'border-l-wrong'}`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="font-bold">
                    Câu {q.id}
                    {q.type ? ` · ${q.type}` : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary">
                      {formatScore(q.earnedPoints)}đ
                    </span>
                    <button
                      type="button"
                      className={`${btnSm} ${isEditing ? 'border-primary text-primary' : 'border-border text-text hover:bg-surface2'}`}
                      onClick={() => toggleEdit(q.id)}
                    >
                      {isEditing ? '✓ Xong' : '✏️ Sửa'}
                    </button>
                  </div>
                </div>
                {q.question && <p className="my-1">{q.question}</p>}
                {q.options.length > 0 && (
                  <ul className={optionsList}>
                    {q.options.map((opt, i) => (
                      <li key={i}>{opt}</li>
                    ))}
                  </ul>
                )}
                <div className="my-2 flex flex-wrap gap-4">
                  <span>
                    Bài làm:{' '}
                    <strong className="text-primary">
                      {q.studentAnswer || '∅'}
                    </strong>
                  </span>
                  <span>
                    Đáp án:{' '}
                    <strong className="text-correct">
                      {q.correctAnswer || '?'}
                    </strong>
                  </span>
                  {!isEditing && (
                    <span
                      className={`font-semibold ${q.isCorrect ? 'text-correct' : 'text-wrong'}`}
                    >
                      {q.isCorrect ? '✓ Đúng' : '✗ Sai'}
                    </span>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      className={`${btnSm} ${q.isCorrect ? 'border-correct text-correct' : 'border-border text-text'}`}
                      onClick={() => setCorrect(q.id, true)}
                    >
                      ✓ Đúng
                    </button>
                    <button
                      type="button"
                      className={`${btnSm} ${!q.isCorrect && q.earnedPoints === 0 ? 'border-wrong text-wrong' : 'border-border text-text'}`}
                      onClick={() => setCorrect(q.id, false)}
                    >
                      ✗ Sai
                    </button>
                    <label className="flex items-center gap-1.5 text-sm text-muted">
                      Điểm lẻ:
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={q.earnedPoints}
                        onChange={(e) => setPoints(q.id, e.target.value)}
                        className="w-20 rounded-lg border border-border bg-bg px-2 py-1.5 text-text focus:outline-none focus:border-primary"
                      />
                    </label>
                  </div>
                )}

                {q.explanation && <p className={explanationBox}>{q.explanation}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <div className={footerBar}>
        {error && <span className="text-wrong">{error}</span>}
        {saved && !error && (
          <span className="font-semibold text-correct">✓ Đã lưu</span>
        )}
        <button
          type="button"
          className={btnPrimary}
          onClick={() => setConfirming(true)}
        >
          Cập nhật
        </button>
      </div>

      {confirming && (
        <ConfirmModal
          title="Xác nhận cập nhật"
          message="Lưu kết quả chấm lại và chuyển trạng thái sang “Đã xác nhận bởi cán bộ chấm thi”?"
          confirmLabel="Cập nhật"
          busy={saving}
          onConfirm={doSave}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
