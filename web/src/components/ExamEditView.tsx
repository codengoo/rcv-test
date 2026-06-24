import { useState } from 'react';
import { ExamDetail, ReviewError, saveExam } from '../api';

interface Props {
  code: string;
  initial: ExamDetail;
}

interface EditQuestion {
  id: string;
  type: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

/**
 * Màn sửa đề cho cán bộ (?exam_edit=NNNNNN): sửa đáp án đúng + lời giải từng
 * câu rồi lưu. KHÔNG đổi câu hỏi/options, KHÔNG chấm lại bài đã chấm.
 */
export function ExamEditView({ code, initial }: Props) {
  const [questions, setQuestions] = useState<EditQuestion[]>(
    initial.questions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  function update(id: string, patch: Partial<EditQuestion>) {
    setSaved(false);
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    );
  }

  async function onSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await saveExam(
        code,
        questions.map((q) => ({
          id: q.id,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
        })),
      );
      setQuestions(
        updated.questions.map((q) => ({
          id: q.id,
          type: q.type,
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
        })),
      );
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ReviewError && err.reason === 'notfound'
          ? 'Không tìm thấy đề (link sửa không hợp lệ).'
          : 'Lưu thất bại, vui lòng thử lại.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="detail__header">
        <h1>{initial.title || `Đề ${initial.examCode}`}</h1>
        <div className="detail__meta">
          <span>Mã đề {initial.examCode}</span>
          <span>{questions.length} câu</span>
        </div>
        <p className="detail__note">
          Chế độ <strong>sửa đề</strong>: chỉnh đáp án đúng và lời giải từng câu,
          rồi bấm “Lưu đề”. Việc sửa không ảnh hưởng các bài đã chấm trước đó.
        </p>
      </header>

      <section className="detail__section">
        <h2>Sửa đáp án & lời giải</h2>
        <div className="questions">
          {questions.map((q) => (
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
              <label className="exam__field">
                Đáp án đúng
                <input
                  type="text"
                  value={q.correctAnswer}
                  onChange={(e) =>
                    update(q.id, { correctAnswer: e.target.value })
                  }
                />
              </label>
              <label className="exam__field">
                Lời giải
                <textarea
                  rows={3}
                  value={q.explanation}
                  onChange={(e) =>
                    update(q.id, { explanation: e.target.value })
                  }
                />
              </label>
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
          {saving ? 'Đang lưu…' : 'Lưu đề'}
        </button>
      </div>
    </div>
  );
}
