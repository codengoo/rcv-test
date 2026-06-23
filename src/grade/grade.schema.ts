import { z } from 'zod';

/**
 * Kết quả AI đọc + chấm bài làm từ ảnh. KHÔNG dùng .nullable()/.optional()
 * (Gemini response_schema reject). Thiếu thông tin → trả "" (text) / 0 (số).
 *
 * Gồm 2 phần:
 *  - Thông tin thí sinh trích từ ảnh (hoTen, boMe, sdtBoMe, lop, maDe).
 *  - Kết quả chấm (đối chiếu câu trả lời với đáp án): perQuestion + điểm.
 */
export const gradeResultSchema = z.object({
  // --- Thông tin thí sinh trích từ ảnh (quy chuẩn) ---
  hoTen: z.string().describe('Họ tên thí sinh đọc từ bài làm; "" nếu không thấy'),
  boMe: z
    .string()
    .describe('Tên bố/mẹ (phụ huynh) ghi trên bài làm; "" nếu không thấy'),
  sdtBoMe: z
    .string()
    .describe('Số điện thoại bố/mẹ, chỉ chữ số; "" nếu không thấy'),
  lop: z.string().describe('Lớp của thí sinh; "" nếu không thấy'),
  maDe: z
    .string()
    .describe('Mã đề ghi trên bài làm của thí sinh; "" nếu không thấy'),

  // --- Kết quả chấm ---
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
          .describe(
            'Câu trả lời thí sinh (quy chuẩn): trắc nghiệm ghi chữ cái A/B/C/D, ' +
              'tự luận ghi nội dung ngắn; "" nếu bỏ trống',
          ),
        dapAnDung: z.string().describe('Đáp án đúng theo kho đáp án'),
        dung: z.boolean().describe('true nếu thí sinh làm đúng câu này'),
      }),
    )
    .describe('Chi tiết chấm từng câu'),
  note: z
    .string()
    .describe(
      'Ghi chú ngắn (vd thiếu tên/sđt, không đọc được mã đề, ảnh mờ); "" nếu không có',
    ),
});

export type GradeResult = z.infer<typeof gradeResultSchema>;
