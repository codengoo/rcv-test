// Class Tailwind dùng chung để các component đồng bộ (button, card, layout…).

export const page = 'max-w-3xl mx-auto px-4 pt-6 pb-16';

export const btnBase =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg font-semibold border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export const btnPrimary = `${btnBase} bg-primary text-bg border-primary hover:brightness-110`;

export const btnGhost = `${btnBase} bg-transparent text-text border-border hover:bg-surface`;

// Nút nhỏ (sửa câu, đúng/sai…).
export const btnSm =
  'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer';

export const card = 'bg-surface border border-border rounded-xl p-4';

export const input =
  'w-full px-3 py-2 rounded-lg border border-border bg-bg text-text focus:outline-none focus:border-primary';

export const badge =
  'inline-block px-2.5 py-0.5 rounded-full border border-border bg-surface text-sm font-semibold';

export const sectionTitle =
  'mb-3 border-b border-border pb-2 text-lg font-semibold';

// Thẻ 1 câu hỏi (viền trái màu để báo đúng/sai khi cần).
export const questionCard =
  'rounded-xl border border-border border-l-4 bg-surface p-4';

export const optionsList = 'my-1.5 list-disc pl-5 text-muted';

export const explanationBox =
  'mt-2 rounded-lg bg-bg px-3 py-2.5 text-sm text-muted whitespace-pre-line';

export const footerBar =
  'mt-6 mb-10 flex items-center justify-end gap-3.5';
