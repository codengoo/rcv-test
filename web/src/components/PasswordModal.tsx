import { FormEvent, useState } from 'react';
import {
  ResultDetail,
  ResultListItem,
  unlockResult,
  UnlockError,
} from '../api';

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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">{item.fullName || 'Xem kết quả'}</h2>
        <p className="modal__hint">
          Nhập mật khẩu để xem chi tiết bài làm.
          <br />
          Mật khẩu là <strong>6 số cuối số điện thoại</strong> của phụ huynh.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            className="modal__input"
            type="text"
            inputMode="numeric"
            autoFocus
            placeholder="6 số cuối số điện thoại"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <p className="modal__error">{error}</p>}
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Hủy
            </button>
            <button
              type="submit"
              className="btn btn--primary"
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
