import { useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import 'yet-another-react-lightbox/styles.css';
import { ResultDetail, formatScore } from '../api';

interface Props {
  detail: ResultDetail;
  onBack: () => void;
}

const NOTE =
  'Bài thi được chấm tự động bởi RCV exam và được chấm lại bởi cán bộ chấm thi.';

function statusLabel(status: string): string {
  return status === 'confirmed'
    ? '🟢 Đã xác nhận bởi cán bộ chấm thi'
    : '🟡 Đã chấm tự động';
}

/** Màn chi tiết: thông tin + ảnh bài làm (zoom/fullscreen) + bảng từng câu. */
export function ResultDetailView({ detail, onBack }: Props) {
  // index >= 0 → mở lightbox tại ảnh đó.
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const slides = detail.images.map((img) => ({ src: img.url }));

  return (
    <div className="page">
      <button type="button" className="btn btn--ghost back" onClick={onBack}>
        ← Quay lại danh sách
      </button>

      <header className="detail__header">
        <h1>{detail.fullName || '(không tên)'}</h1>
        <div className="detail__meta">
          <span>Lớp {detail.className || '-'}</span>
          <span>Mã đề {detail.examCode}</span>
          <span className="detail__score">
            Điểm: {detail.scoreText} điểm ({detail.correctCount}/
            {detail.totalQuestions} câu đúng)
          </span>
          <span className="badge">{statusLabel(detail.status)}</span>
        </div>
        <p className="detail__note">{NOTE}</p>
        {detail.note && <p className="detail__note">Ghi chú: {detail.note}</p>}
      </header>

      {slides.length > 0 && (
        <section className="detail__section">
          <h2>Ảnh bài làm</h2>
          <div className="thumbs">
            {detail.images.map((img, i) => (
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
        <h2>Chi tiết từng câu</h2>
        <div className="questions">
          {detail.questions.map((q) => (
            <div
              key={q.id}
              className={`question ${q.isCorrect ? 'question--correct' : 'question--wrong'}`}
            >
              <div className="question__head">
                <span className="question__no">Câu {q.id}</span>
                <span className="question__status">
                  {q.isCorrect ? '✓ Đúng' : '✗ Sai'} · {formatScore(q.earnedPoints)}đ
                </span>
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
              {q.explanation && (
                <p className="question__explanation">{q.explanation}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
