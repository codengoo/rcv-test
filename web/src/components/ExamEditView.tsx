import { useState } from 'react';
import { ExamDetail, ReviewError, saveExam } from '../api';
import { ConfirmModal } from './ConfirmModal';
import {
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

/** Chữ cái đầu (A–D) của 1 lựa chọn/đáp án, '' nếu không có. */
function answerLetter(s: string): string {
  const m = /^([A-D])\b[.)]?/i.exec(s.trim());
  return m ? m[1].toUpperCase() : '';
}

/** Lựa chọn `opt` có phải đáp án đúng hiện tại không (khớp theo chữ cái A–D). */
function isChosen(opt: string, answer: string): boolean {
  if (!answer) return false;
  const lo = answerLetter(opt);
  const la = answerLetter(answer);
  if (lo && la) return lo === la;
  return opt.trim() === answer.trim();
}

function toEdit(qs: ExamDetail['questions']): EditQuestion[] {
  return qs.map((q) => ({
    id: q.id,
    type: q.type,
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
  }));
}

/**
 * Màn xem & sửa đề cho cán bộ (?exam_edit=NNNNNN): mỗi câu mặc định xem; bấm
 * "Sửa" mở chỉnh sửa CHỈ câu đó (đáp án đúng + lời giải). "Cập nhật" cuối trang
 * mở popup xác nhận rồi lưu. KHÔNG đổi câu hỏi/options, KHÔNG chấm lại bài cũ.
 */
export function ExamEditView({ code, initial }: Props) {
  const [questions, setQuestions] = useState<EditQuestion[]>(
    toEdit(initial.questions),
  );
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

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

  async function doSave() {
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
      setQuestions(toEdit(updated.questions));
      setEditing(new Set());
      setSaved(true);
      setConfirming(false);
    } catch (err) {
      setError(
        err instanceof ReviewError && err.reason === 'notfound'
          ? 'Không tìm thấy đề (link sửa không hợp lệ).'
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
          {initial.title || `Đề ${initial.examCode}`}
        </h1>
        <div className="mt-2 flex flex-wrap gap-4 text-muted">
          <span>Mã đề {initial.examCode}</span>
          <span>{questions.length} câu</span>
        </div>
        <p className="mt-2 text-muted">
          Mỗi câu hiển thị ở chế độ xem; bấm <strong>Sửa</strong> để chỉnh đáp án
          đúng và lời giải của câu đó, rồi bấm “Cập nhật”. Việc sửa không ảnh
          hưởng các bài đã chấm trước đó.
        </p>
      </header>

      <section className="mb-8">
        <h2 className={sectionTitle}>Đề & đáp án</h2>
        <div className="flex flex-col gap-3.5">
          {questions.map((q) => {
            const isEditing = editing.has(q.id);
            return (
              <div key={q.id} className={questionCard}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="font-bold">
                    Câu {q.id}
                    {q.type ? ` · ${q.type}` : ''}
                  </span>
                  <button
                    type="button"
                    className={`${btnSm} ${isEditing ? 'border-primary text-primary' : 'border-border text-text hover:bg-surface2'}`}
                    onClick={() => toggleEdit(q.id)}
                  >
                    {isEditing ? '✓ Xong' : '✏️ Sửa'}
                  </button>
                </div>
                {q.question && <p className="my-1">{q.question}</p>}
                {/* Chế độ xem: liệt kê lựa chọn (trắc nghiệm). */}
                {!isEditing && q.options.length > 0 && (
                  <ul className={optionsList}>
                    {q.options.map((opt, i) => (
                      <li key={i}>{opt}</li>
                    ))}
                  </ul>
                )}

                {isEditing ? (
                  <>
                    {q.options.length > 0 ? (
                      // Trắc nghiệm: bấm A/B/C/D để chọn lại đáp án đúng.
                      <div className="mt-2.5">
                        <span className="text-sm text-muted">
                          Chọn đáp án đúng
                        </span>
                        <div className="mt-1.5 flex flex-col gap-2">
                          {q.options.map((opt, i) => {
                            const chosen = isChosen(opt, q.correctAnswer);
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() =>
                                  update(q.id, { correctAnswer: opt })
                                }
                                className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${
                                  chosen
                                    ? 'border-correct bg-correct/10 text-correct'
                                    : 'border-border hover:bg-surface2'
                                }`}
                              >
                                {chosen ? '● ' : '○ '}
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      // Tự luận/điền: nhập đáp án đúng bằng text.
                      <label className="mt-2.5 flex flex-col gap-1.5 text-sm text-muted">
                        Đáp án đúng
                        <input
                          type="text"
                          value={q.correctAnswer}
                          onChange={(e) =>
                            update(q.id, { correctAnswer: e.target.value })
                          }
                          className="rounded-lg border border-border bg-bg px-2.5 py-2 text-text focus:outline-none focus:border-primary"
                        />
                      </label>
                    )}
                    <label className="mt-2.5 flex flex-col gap-1.5 text-sm text-muted">
                      Lời giải
                      <textarea
                        rows={3}
                        value={q.explanation}
                        onChange={(e) =>
                          update(q.id, { explanation: e.target.value })
                        }
                        className="resize-y rounded-lg border border-border bg-bg px-2.5 py-2 text-text focus:outline-none focus:border-primary"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <div className="my-2">
                      Đáp án:{' '}
                      <strong className="text-correct">
                        {q.correctAnswer || '?'}
                      </strong>
                    </div>
                    {q.explanation && (
                      <p className={explanationBox}>{q.explanation}</p>
                    )}
                  </>
                )}
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
          title="Xác nhận cập nhật đề"
          message="Lưu thay đổi đáp án và lời giải cho đề này? Các bài đã chấm trước đó không bị ảnh hưởng."
          confirmLabel="Cập nhật"
          busy={saving}
          onConfirm={doSave}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
