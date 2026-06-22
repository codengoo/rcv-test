import { z } from 'zod';

/**
 * Schema trích xuất hóa đơn (task 2). KHÔNG dùng .nullable()/.optional():
 * Gemini response_schema chỉ nhận `type` đơn trị, nullable bị dịch thành mảng
 * type và bị reject. Field thiếu → model trả "" (text) hoặc 0 (total).
 */
export const receiptSchema = z.object({
  storeName: z
    .string()
    .describe('Tên cửa hàng / merchant in trên hóa đơn; "" nếu không có'),
  storeAddress: z.string().describe('Địa chỉ cửa hàng; "" nếu không có'),
  date: z
    .string()
    .describe('Ngày trên hóa đơn, giữ nguyên định dạng in trên bill; "" nếu không có'),
  total: z
    .number()
    .describe(
      'Tổng giá trị đơn dạng số, bỏ ký hiệu tiền tệ và dấu phân cách; 0 nếu không xác định',
    ),
  currency: z
    .string()
    .describe('Đơn vị tiền tệ, vd "VND", "USD"; "" nếu không xác định'),
});

export type ReceiptData = z.infer<typeof receiptSchema>;
