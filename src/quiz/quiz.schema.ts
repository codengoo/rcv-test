import { z } from 'zod';

/** Các loại câu hỏi được hỗ trợ. */
export const QUESTION_TYPES = [
  'multiple_choice', // trắc nghiệm A/B/C/D
  'fill_blank', // điền ô trống
  'error_correction', // sửa lỗi
] as const;

/**
 * Cấu trúc đề thi do AI trích khi chạy /add-quiz. KHÔNG dùng
 * .nullable()/.optional() (Gemini response_schema reject). Field thiếu →
 * "" (text) / [] (mảng).
 */
export const examSchema = z.object({
  title: z.string().describe('Tên/tiêu đề đề thi; "" nếu không xác định'),
  examCode: z.string().describe('Mã đề, vd "A01"; "" nếu không xác định'),
  questions: z
    .array(
      z.object({
        id: z.string().describe('Số/tên câu, vd "1", "2"'),
        type: z
          .string()
          .describe(
            'Loại câu: "multiple_choice" | "fill_blank" | "error_correction"',
          ),
        question: z.string().describe('Nội dung đề bài của câu'),
        options: z
          .array(z.string())
          .describe(
            'Các lựa chọn của câu trắc nghiệm (vd "A. ...", "B. ..."); [] nếu không phải trắc nghiệm',
          ),
        correctAnswer: z
          .string()
          .describe(
            'Đáp án đúng (quy chuẩn): trắc nghiệm ghi chữ cái + nội dung (vd "B. Con ếch"); ' +
              'điền ô trống / sửa lỗi ghi nội dung đúng',
          ),
        explanation: z.string().describe('Giải thích đáp án; "" nếu không có'),
      }),
    )
    .describe('Danh sách câu hỏi của đề'),
});

export type Exam = z.infer<typeof examSchema>;
export type ExamQuestion = Exam['questions'][number];
