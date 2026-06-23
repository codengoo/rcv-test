import { z } from 'zod';

/**
 * Kết quả AI đọc + chấm bài làm từ ảnh. KHÔNG dùng .nullable()/.optional()
 * (Gemini response_schema reject). Thiếu thông tin → "" (text) / 0 (số).
 *
 * Gồm 2 phần:
 *  - Thông tin thí sinh trích từ ảnh (fullName, parentName, parentPhone,
 *    className, examCode).
 *  - Kết quả chấm: questions[] + điểm.
 */
export const gradingResultSchema = z.object({
  // --- Thông tin thí sinh trích từ ảnh (quy chuẩn) ---
  fullName: z
    .string()
    .describe('Họ tên thí sinh đọc từ bài làm; "" nếu không thấy'),
  parentName: z
    .string()
    .describe('Tên bố/mẹ (phụ huynh) ghi trên bài làm; "" nếu không thấy'),
  parentPhone: z
    .string()
    .describe('Số điện thoại bố/mẹ, chỉ chữ số; "" nếu không thấy'),
  className: z.string().describe('Lớp của thí sinh; "" nếu không thấy'),
  examCode: z
    .string()
    .describe(
      'Mã đề đọc được trên bài làm (để đối chiếu với mã đề nhập tay); "" nếu không thấy',
    ),

  // --- Kết quả chấm ---
  totalQuestions: z.number().describe('Tổng số câu trong đáp án được cung cấp'),
  correctCount: z.number().describe('Số câu thí sinh làm đúng'),
  questions: z
    .array(
      z.object({
        id: z.string().describe('Số/tên câu, khớp với id trong đáp án'),
        studentAnswer: z
          .string()
          .describe(
            'Câu trả lời thí sinh (quy chuẩn): trắc nghiệm ghi chữ cái A/B/C/D, ' +
              'còn lại ghi nội dung ngắn; "" nếu bỏ trống',
          ),
        correctAnswer: z.string().describe('Đáp án đúng theo đáp án cung cấp'),
        isCorrect: z.boolean().describe('true nếu thí sinh làm đúng câu này'),
      }),
    )
    .describe('Chi tiết chấm từng câu'),
  note: z
    .string()
    .describe(
      'Ghi chú ngắn (vd thiếu tên/sđt, mã đề lệch, ảnh mờ); "" nếu không có',
    ),
});

export type GradingResult = z.infer<typeof gradingResultSchema>;
