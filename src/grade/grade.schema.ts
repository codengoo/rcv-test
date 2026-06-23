import { z } from 'zod';

/** Kết quả AI chấm bài làm. KHÔNG dùng .nullable() (Gemini response_schema reject). */
export const gradeResultSchema = z.object({
  maDe: z
    .string()
    .describe('Mã đề đọc được ghi trên bài làm của thí sinh; "" nếu không thấy'),
  totalQuestions: z
    .number()
    .describe('Tổng số câu của đề tương ứng trong kho đáp án'),
  correctCount: z.number().describe('Số câu thí sinh làm đúng so với đáp án'),
  perQuestion: z
    .array(
      z.object({
        cau: z.number().describe('Số thứ tự câu'),
        dapAnChon: z
          .string()
          .describe('Đáp án thí sinh chọn/ghi trên bài; "" nếu bỏ trống'),
        dapAnDung: z.string().describe('Đáp án đúng theo kho đáp án'),
        dung: z.boolean().describe('true nếu thí sinh làm đúng câu này'),
      }),
    )
    .describe('Chi tiết chấm từng câu'),
  note: z
    .string()
    .describe('Ghi chú ngắn (vd không đọc được mã đề, ảnh mờ); "" nếu không có'),
});

export type GradeResult = z.infer<typeof gradeResultSchema>;
