import { ExamDetail } from '../api';
import {
  explanationBox,
  optionsList,
  page,
  questionCard,
  sectionTitle,
} from '../ui';

interface Props {
  detail: ExamDetail;
}

/** Màn xem đề (công khai): câu hỏi + đáp án đúng + lời giải, chỉ đọc. */
export function ExamView({ detail }: Props) {
  return (
    <div className={page}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">
          {detail.title || `Đề ${detail.examCode}`}
        </h1>
        <div className="mt-2 flex flex-wrap gap-4 text-muted">
          <span>Mã đề {detail.examCode}</span>
          <span>{detail.questions.length} câu</span>
        </div>
      </header>

      <section className="mb-8">
        <h2 className={sectionTitle}>Đề & đáp án</h2>
        <div className="flex flex-col gap-3.5">
          {detail.questions.map((q) => (
            <div key={q.id} className={questionCard}>
              <div className="mb-1.5 font-bold">
                Câu {q.id}
                {q.type ? ` · ${q.type}` : ''}
              </div>
              {q.question && <p className="my-1">{q.question}</p>}
              {q.options.length > 0 && (
                <ul className={optionsList}>
                  {q.options.map((opt, i) => (
                    <li key={i}>{opt}</li>
                  ))}
                </ul>
              )}
              <div className="my-2">
                Đáp án:{' '}
                <strong className="text-correct">
                  {q.correctAnswer || '?'}
                </strong>
              </div>
              {q.explanation && <p className={explanationBox}>{q.explanation}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
