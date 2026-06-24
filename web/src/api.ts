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
  type: string;
  question: string;
  options: string[];
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  earnedPoints: number;
  explanation: string;
}

export interface ResultDetail {
  id: string;
  status: string;
  fullName: string;
  className: string;
  examCode: string;
  score: string;
  correctCount: number;
  totalQuestions: number;
  totalScore: number;
  scoreText: string;
  note: string;
  images: { url: string }[];
  questions: ResultDetailQuestion[];
}

/** Chi tiết bài thi cho giám thị sửa (truy cập bằng reviewCode trong URL). */
export interface ReviewDetail {
  id: string;
  status: string;
  fullName: string;
  className: string;
  examCode: string;
  totalScore: number;
  maxScore: number;
  scoreText: string;
  note: string;
  images: { url: string }[];
  questions: ResultDetailQuestion[];
}

/** Một chỉnh sửa gửi lên server khi giám thị lưu. */
export interface ReviewEditInput {
  id: string;
  isCorrect: boolean;
  earnedPoints: number;
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

/** Lý do tải/lưu trang sửa thất bại. */
export type ReviewFailReason = 'notfound' | 'network';

export class ReviewError extends Error {
  constructor(public reason: ReviewFailReason) {
    super(reason);
  }
}

/** Lấy chi tiết bài thi để giám thị sửa (code 6 số trong URL). */
export async function getReview(code: string): Promise<ReviewDetail> {
  let res: Response;
  try {
    res = await fetch(`/api/review/${encodeURIComponent(code)}`);
  } catch {
    throw new ReviewError('network');
  }
  if (res.status === 404) throw new ReviewError('notfound');
  if (!res.ok) throw new ReviewError('network');
  return (await res.json()) as ReviewDetail;
}

/** Lưu chỉnh sửa của giám thị → trả lại chi tiết đã cập nhật. */
export async function saveReview(
  code: string,
  questions: ReviewEditInput[],
): Promise<ReviewDetail> {
  let res: Response;
  try {
    res = await fetch(`/api/review/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions }),
    });
  } catch {
    throw new ReviewError('network');
  }
  if (res.status === 404) throw new ReviewError('notfound');
  if (!res.ok) throw new ReviewError('network');
  return (await res.json()) as ReviewDetail;
}

/** Format điểm hiển thị, bỏ .00 thừa: 4 -> "4", 3.5 -> "3.5", 3.75 -> "3.75". */
export function formatScore(n: number): string {
  return Number((Math.round(n * 100) / 100).toFixed(2)).toString();
}

/** Một câu trong đề (xem/sửa). */
export interface ExamQuestionItem {
  id: string;
  type: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export interface ExamDetail {
  examCode: string;
  title: string;
  questions: ExamQuestionItem[];
}

/** Một chỉnh sửa đáp án/giải thích gửi lên server. */
export interface ExamAnswerEditInput {
  id: string;
  correctAnswer: string;
  explanation: string;
}

/** Xem đề công khai theo examCode. */
export async function getExam(examCode: string): Promise<ExamDetail> {
  let res: Response;
  try {
    res = await fetch(`/api/exam/${encodeURIComponent(examCode)}`);
  } catch {
    throw new ReviewError('network');
  }
  if (res.status === 404) throw new ReviewError('notfound');
  if (!res.ok) throw new ReviewError('network');
  return (await res.json()) as ExamDetail;
}

/** Lấy đề để sửa theo editCode 6 số. */
export async function getExamForEdit(code: string): Promise<ExamDetail> {
  let res: Response;
  try {
    res = await fetch(`/api/exam-edit/${encodeURIComponent(code)}`);
  } catch {
    throw new ReviewError('network');
  }
  if (res.status === 404) throw new ReviewError('notfound');
  if (!res.ok) throw new ReviewError('network');
  return (await res.json()) as ExamDetail;
}

/** Lưu sửa đáp án + giải thích → trả lại đề đã cập nhật. */
export async function saveExam(
  code: string,
  questions: ExamAnswerEditInput[],
): Promise<ExamDetail> {
  let res: Response;
  try {
    res = await fetch(`/api/exam-edit/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions }),
    });
  } catch {
    throw new ReviewError('network');
  }
  if (res.status === 404) throw new ReviewError('notfound');
  if (!res.ok) throw new ReviewError('network');
  return (await res.json()) as ExamDetail;
}
