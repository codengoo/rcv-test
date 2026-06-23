import { ResultListItem } from '../api';

interface Props {
  items: ResultListItem[];
  onSelect: (item: ResultListItem) => void;
}

/** Bảng danh sách thí sinh công khai (tên, lớp, mã đề, điểm). */
export function ResultList({ items, onSelect }: Props) {
  return (
    <div className="card-grid">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="result-card"
          onClick={() => onSelect(it)}
        >
          <div className="result-card__name">{it.fullName || '(không tên)'}</div>
          <div className="result-card__meta">
            <span>Lớp {it.className || '-'}</span>
            <span>Mã đề {it.examCode}</span>
          </div>
          <div className="result-card__score">{it.score || '—'}</div>
          <div className="result-card__hint">Bấm để xem chi tiết →</div>
        </button>
      ))}
    </div>
  );
}
