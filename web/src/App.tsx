import { useEffect, useState } from 'react';
import { fetchResults, ResultDetail, ResultListItem } from './api';
import { ResultList } from './components/ResultList';
import { PasswordModal } from './components/PasswordModal';
import { ResultDetailView } from './components/ResultDetailView';

/** Bỏ dấu + thường hóa để tìm tên tiếng Việt không phân biệt dấu. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

export default function App() {
  const [items, setItems] = useState<ResultListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');

  // Item đang mở modal nhập mật khẩu (null = không mở).
  const [modalItem, setModalItem] = useState<ResultListItem | null>(null);
  // Chi tiết đã unlock (null = đang ở màn danh sách).
  const [detail, setDetail] = useState<ResultDetail | null>(null);

  // ?result_id=... → mở sẵn modal nhập mật khẩu cho kết quả đó.
  const resultId = new URLSearchParams(window.location.search).get('result_id');

  useEffect(() => {
    fetchResults()
      .then((list) => {
        setItems(list);
        if (resultId) {
          const found = list.find((it) => it.id === resultId);
          setModalItem(
            found ?? {
              id: resultId,
              fullName: '',
              className: '',
              score: '',
              examCode: '',
              createdAt: '',
            },
          );
        }
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [resultId]);

  const filtered = query.trim()
    ? items.filter((it) => normalize(it.fullName).includes(normalize(query)))
    : items;

  if (detail) {
    return (
      <ResultDetailView detail={detail} onBack={() => setDetail(null)} />
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <h1>Tra cứu kết quả thi</h1>
        <p className="page__subtitle">
          Chọn thí sinh và nhập mật khẩu để xem chi tiết bài làm.
        </p>
      </header>

      {loading && <p className="state">Đang tải danh sách…</p>}
      {loadError && <p className="state state--error">{loadError}</p>}
      {!loading && !loadError && items.length === 0 && (
        <p className="state">Chưa có kết quả nào.</p>
      )}

      {!loading && !loadError && items.length > 0 && (
        <>
          <input
            className="search"
            type="search"
            placeholder="Tìm theo tên thí sinh…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length > 0 ? (
            <ResultList items={filtered} onSelect={setModalItem} />
          ) : (
            <p className="state">Không tìm thấy thí sinh nào.</p>
          )}
        </>
      )}

      {modalItem && (
        <PasswordModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          onUnlocked={(d) => {
            setModalItem(null);
            setDetail(d);
          }}
        />
      )}
    </div>
  );
}
