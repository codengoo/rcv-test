import { ResultListItem } from '../api';

interface Props {
  items: ResultListItem[];
  onSelect: (item: ResultListItem) => void;
}

/** Bảng danh sách thí sinh công khai (tên, lớp, mã đề, điểm). */
export function ResultList({ items, onSelect }: Props) {
  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-primary cursor-pointer"
          onClick={() => onSelect(it)}
        >
          <div className="font-semibold">{it.fullName || '(không tên)'}</div>
          <div className="flex flex-wrap gap-3 text-sm text-muted">
            <span>Lớp {it.className || '-'}</span>
            <span>Mã đề {it.examCode}</span>
          </div>
          <div className="text-lg font-bold text-primary">{it.score || '—'}</div>
          <div className="text-sm text-muted">Bấm để xem chi tiết →</div>
        </button>
      ))}
    </div>
  );
}
