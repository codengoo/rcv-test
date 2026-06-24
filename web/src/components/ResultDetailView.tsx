import { useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import 'yet-another-react-lightbox/styles.css';
import { ResultDetail, formatScore } from '../api';
import {
  badge,
  btnGhost,
  explanationBox,
  optionsList,
  page,
  questionCard,
  sectionTitle,
} from '../ui';

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
    <div className={page}>
      <button type="button" className={`${btnGhost} mb-4`} onClick={onBack}>
        ← Quay lại danh sách
      </button>

      <header className="mb-6">
        <h1 className="text-2xl font-bold">{detail.fullName || '(không tên)'}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-muted">
          <span>Lớp {detail.className || '-'}</span>
          <span>Mã đề {detail.examCode}</span>
          <span className="font-bold text-primary">
            Điểm: {detail.scoreText} điểm ({detail.correctCount}/
            {detail.totalQuestions} câu đúng)
          </span>
          <span className={badge}>{statusLabel(detail.status)}</span>
        </div>
        <p className="mt-2 text-muted">{NOTE}</p>
        {detail.note && <p className="mt-2 text-muted">Ghi chú: {detail.note}</p>}
      </header>

      {slides.length > 0 && (
        <section className="mb-8">
          <h2 className={sectionTitle}>Ảnh bài làm</h2>
          <div className="flex flex-wrap gap-3">
            {detail.images.map((img, i) => (
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
        <h2 className={sectionTitle}>Chi tiết từng câu</h2>
        <div className="flex flex-col gap-3.5">
          {detail.questions.map((q) => (
            <div
              key={q.id}
              className={`${questionCard} ${q.isCorrect ? 'border-l-correct' : 'border-l-wrong'}`}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-bold">Câu {q.id}</span>
                <span
                  className={`font-semibold ${q.isCorrect ? 'text-correct' : 'text-wrong'}`}
                >
                  {q.isCorrect ? '✓ Đúng' : '✗ Sai'} · {formatScore(q.earnedPoints)}đ
                </span>
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
              </div>
              {q.explanation && <p className={explanationBox}>{q.explanation}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
