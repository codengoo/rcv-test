import { z } from 'zod';

/** Output AI khi giải đề. KHÔNG dùng .nullable() (Gemini response_schema reject). */
export const quizSolutionSchema = z.object({
  title: z.string().describe('Tên/tiêu đề của đề thi; "" nếu không xác định'),
  questionCount: z
    .number()
    .describe('Tổng số câu hỏi đã giải trong đề'),
  markdown: z
    .string()
    .describe(
      'Toàn bộ lời giải dạng Markdown thân thiện với agent: mỗi câu gồm số câu, ' +
        'đề tóm tắt, đáp án đúng, và chỉ dẫn chấm điểm (rubric) rõ ràng',
    ),
});

export type QuizSolution = z.infer<typeof quizSolutionSchema>;
