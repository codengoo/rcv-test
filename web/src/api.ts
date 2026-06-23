// Client gọi 2 endpoint của Nest. Dev: Vite proxy /api → :3000. Prod: cùng origin.

export interface ResultListItem {
  id: string;
  fullName: string;
  className: string;
  score: string;
  examCode: string;
  createdAt: string;
}

export interface ResultDetailQuestion {
  id: string;
  question: string;
  options: string[];
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
}

export interface ResultDetail {
  id: string;
  fullName: string;
  className: string;
  examCode: string;
  score: string;
  correctCount: number;
  totalQuestions: number;
  note: string;
  images: { url: string }[];
  questions: ResultDetailQuestion[];
}

/** Lý do unlock thất bại để UI hiển thị thông điệp phù hợp. */
export type UnlockFailReason = 'wrong' | 'rate' | 'network';

export class UnlockError extends Error {
  constructor(public reason: UnlockFailReason) {
    super(reason);
  }
}

export async function fetchResults(): Promise<ResultListItem[]> {
  const res = await fetch('/api/results');
  if (!res.ok) throw new Error(`Không tải được danh sách (HTTP ${res.status})`);
  const data = (await res.json()) as { items: ResultListItem[] };
  return data.items ?? [];
}

export async function unlockResult(
  id: string,
  code: string,
): Promise<ResultDetail> {
  let res: Response;
  try {
    res = await fetch(`/api/results/${id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new UnlockError('network');
  }
  if (res.status === 401) throw new UnlockError('wrong');
  if (res.status === 429) throw new UnlockError('rate');
  if (!res.ok) throw new UnlockError('network');
  return (await res.json()) as ResultDetail;
}
