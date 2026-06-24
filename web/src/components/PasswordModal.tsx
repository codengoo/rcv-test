import { FormEvent, useState } from 'react';
import {
  ResultDetail,
  ResultListItem,
  unlockResult,
  UnlockError,
} from '../api';
import { btnGhost, btnPrimary, input } from '../ui';

interface Props {
  item: ResultListItem;
  onClose: () => void;
  onUnlocked: (detail: ResultDetail) => void;
}

const MESSAGES: Record<string, string> = {
  wrong: 'Mật khẩu không đúng. Vui lòng thử lại.',
  rate: 'Bạn thử quá nhiều lần. Vui lòng đợi một phút rồi thử lại.',
  network: 'Lỗi kết nối. Vui lòng thử lại.',
};

/** Modal nhập mật khẩu (accessCode). Gửi qua POST, không lưu localStorage. */
export function PasswordModal({ item, onClose, onUnlocked }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const detail = await unlockResult(item.id, code.trim());
      onUnlocked(detail);
    } catch (err) {
      const reason = err instanceof UnlockError ? err.reason : 'network';
      setError(MESSAGES[reason]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{item.fullName || 'Xem kết quả'}</h2>
        <p className="mt-2 text-muted">
          Nhập mật khẩu để xem chi tiết bài làm.
          <br />
          Mật khẩu là <strong>6 số cuối số điện thoại</strong> của phụ huynh.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            className={`${input} mt-3`}
            type="text"
            inputMode="numeric"
            autoFocus
            placeholder="6 số cuối số điện thoại"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <p className="mt-2 text-wrong">{error}</p>}
          <div className="mt-4 flex justify-end gap-2.5">
            <button type="button" className={btnGhost} onClick={onClose}>
              Hủy
            </button>
            <button
              type="submit"
              className={btnPrimary}
              disabled={submitting || !code.trim()}
            >
              {submitting ? 'Đang kiểm tra…' : 'Xem kết quả'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
