import { useMemo, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import 'yet-another-react-lightbox/styles.css';
import {
  ReviewDetail,
  ReviewError,
  formatScore,
  saveReview,
} from '../api';

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

/** Giới hạn điểm 1 câu về [0,1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Màn sửa kết quả cho giám thị (?review_code=NNNNNN). Toggle đúng/sai + ô điểm
 * lẻ từng câu; tổng điểm tính realtime; lưu → status chuyển confirmed.
 */
export function ReviewView({ code, initial }: Props) {
  const [meta, setMeta] = useState({
    status: initial.status,
    fullName: initial.fullName,
    className: initial.className,
    examCode: initial.examCode,
    note: initial.note,
  });
  const [questions, setQuestions] = useState<EditQuestion[]>(
    initial.questions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      options: q.options,
      studentAnswer: q.studentAnswer,
      correctAnswer: q.correctAnswer,
      isCorrect: q.isCorrect,
      earnedPoints: q.earnedPoints,
      explanation: q.explanation,
    })),
  );
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

  function update(id: string, patch: Partial<EditQuestion>) {
    setSaved(false);
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    );
  }

  /** Bấm Đúng/Sai → set isCorrect + điểm full/0. */
  function setCorrect(id: string, isCorrect: boolean) {
    update(id, { isCorrect, earnedPoints: isCorrect ? 1 : 0 });
  }

  /** Nhập điểm lẻ → clamp [0,1]; ≥1 coi là đúng, =0 coi là sai. */
  function setPoints(id: string, raw: string) {
    const n = clamp01(parseFloat(raw));
    update(id, { earnedPoints: n, isCorrect: n >= 1 });
  }

  async function onSave() {
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
      setMeta({
        status: updated.status,
        fullName: updated.fullName,
        className: updated.className,
        examCode: updated.examCode,
        note: updated.note,
      });
      setQuestions(
        updated.questions.map((q) => ({
          id: q.id,
          type: q.type,
          question: q.question,
          options: q.options,
          studentAnswer: q.studentAnswer,
          correctAnswer: q.correctAnswer,
          isCorrect: q.isCorrect,
          earnedPoints: q.earnedPoints,
          explanation: q.explanation,
        })),
      );
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ReviewError && err.reason === 'notfound'
          ? 'Không tìm thấy bài thi (link sửa không hợp lệ).'
          : 'Lưu thất bại, vui lòng thử lại.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="detail__header">
        <h1>{meta.fullName || '(không tên)'}</h1>
        <div className="detail__meta">
          <span>Lớp {meta.className || '-'}</span>
          <span>Mã đề {meta.examCode}</span>
          <span className="detail__score">
            Điểm: {formatScore(total)} / {maxScore}
          </span>
          <span className="badge">{statusLabel(meta.status)}</span>
        </div>
        <p className="detail__note">{NOTE}</p>
        <p className="detail__note">
          Bạn đang ở chế độ <strong>chấm lại</strong>: chỉnh đúng/sai hoặc nhập
          điểm lẻ (0–1) cho câu tự luận, rồi bấm “Lưu xác nhận”.
        </p>
      </header>

      {slides.length > 0 && (
        <section className="detail__section">
          <h2>Ảnh bài làm</h2>
          <div className="thumbs">
            {initial.images.map((img, i) => (
              <button
                key={i}
                type="button"
                className="thumb"
                onClick={() => setLightboxIndex(i)}
              >
                <img src={img.url} alt={`Trang ${i + 1}`} loading="lazy" />
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

      <section className="detail__section">
        <h2>Chấm từng câu</h2>
        <div className="questions">
          {questions.map((q) => (
            <div
              key={q.id}
              className={`question ${q.isCorrect ? 'question--correct' : 'question--wrong'}`}
            >
              <div className="question__head">
                <span className="question__no">
                  Câu {q.id}
                  {q.type ? ` · ${q.type}` : ''}
                </span>
                <span className="review__points">{formatScore(q.earnedPoints)}đ</span>
              </div>
              {q.question && <p className="question__text">{q.question}</p>}
              {q.options.length > 0 && (
                <ul className="question__options">
                  {q.options.map((opt, i) => (
                    <li key={i}>{opt}</li>
                  ))}
                </ul>
              )}
              <div className="question__answers">
                <span className="answer answer--student">
                  Bài làm: <strong>{q.studentAnswer || '∅'}</strong>
                </span>
                <span className="answer answer--correct">
                  Đáp án: <strong>{q.correctAnswer || '?'}</strong>
                </span>
              </div>
              <div className="review__controls">
                <button
                  type="button"
                  className={`btn btn--toggle ${q.isCorrect ? 'is-active is-correct' : ''}`}
                  onClick={() => setCorrect(q.id, true)}
                >
                  ✓ Đúng
                </button>
                <button
                  type="button"
                  className={`btn btn--toggle ${!q.isCorrect && q.earnedPoints === 0 ? 'is-active is-wrong' : ''}`}
                  onClick={() => setCorrect(q.id, false)}
                >
                  ✗ Sai
                </button>
                <label className="review__pointsInput">
                  Điểm lẻ:
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={q.earnedPoints}
                    onChange={(e) => setPoints(q.id, e.target.value)}
                  />
                </label>
              </div>
              {q.explanation && (
                <p className="question__explanation">{q.explanation}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="review__footer">
        {error && <span className="state state--error">{error}</span>}
        {saved && !error && <span className="review__saved">✓ Đã lưu</span>}
        <button
          type="button"
          className="btn btn--primary"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? 'Đang lưu…' : 'Lưu xác nhận'}
        </button>
      </div>
    </div>
  );
}
