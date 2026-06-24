import { btnGhost, btnPrimary } from '../ui';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Popup xác nhận trước khi thực hiện hành động (lưu review / lưu đề). */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Xác nhận',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-2 text-muted">{message}</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" className={btnGhost} onClick={onCancel} disabled={busy}>
            Hủy
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Đang lưu…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
