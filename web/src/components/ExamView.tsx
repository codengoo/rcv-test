import { ExamDetail } from '../api';

interface Props {
  detail: ExamDetail;
}

/** Màn xem đề (công khai): câu hỏi + đáp án đúng + lời giải, chỉ đọc. */
export function ExamView({ detail }: Props) {
  return (
    <div className="page">
      <header className="detail__header">
        <h1>{detail.title || `Đề ${detail.examCode}`}</h1>
        <div className="detail__meta">
          <span>Mã đề {detail.examCode}</span>
          <span>{detail.questions.length} câu</span>
        </div>
      </header>

      <section className="detail__section">
        <h2>Đề & đáp án</h2>
        <div className="questions">
          {detail.questions.map((q) => (
            <div key={q.id} className="question">
              <div className="question__head">
                <span className="question__no">
                  Câu {q.id}
                  {q.type ? ` · ${q.type}` : ''}
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
