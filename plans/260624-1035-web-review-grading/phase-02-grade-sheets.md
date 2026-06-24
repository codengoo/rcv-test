# Phase 02 — Grade carry type/điểm + Sheets append-range & update

**Goal:** GradeService trả thêm `type` và `earnedPoints` cho mỗi câu (earnedPoints = isCorrect?1:0 lúc chấm tự động) và tổng `totalScore`/`maxScore`. GoogleSheetsService: `appendRow` trả về `updatedRange`, và có `updateCell` để sửa 1 ô.

## 1. Files chạm vào
| File | Action |
|---|---|
| src/grade/grade.service.ts | MODIFY |
| src/shared/google-sheets/google-sheets.service.ts | MODIFY |

## 2. grade.service.ts
### 2a. GradedQuestion thêm field
```ts
export interface GradedQuestion {
  id: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  type: string;          // MỚI — carry từ Exam
  earnedPoints: number;  // MỚI — isCorrect ? 1 : 0
  question: string;
  options: string[];
  explanation: string;
}
```
### 2b. GradeOutput thêm tổng điểm
```ts
// thêm cạnh correctCount/totalQuestions:
totalScore: number; // = correctCount (mỗi câu 1đ) lúc chấm tự động
maxScore: number;   // = totalQuestions
```
### 2c. join — set type + earnedPoints
Trong `result.questions.map`:
```ts
return {
  id: q.id,
  studentAnswer: q.studentAnswer,
  correctAnswer: src?.correctAnswer ?? '',
  isCorrect: q.isCorrect,
  type: src?.type ?? '',
  earnedPoints: q.isCorrect ? 1 : 0,
  question: src?.question ?? '',
  options: src?.options ?? [],
  explanation: src?.explanation ?? '',
};
```
Và return thêm:
```ts
totalScore: result.correctCount,
maxScore: result.totalQuestions,
```

## 3. google-sheets.service.ts
### 3a. appendRow trả updatedRange
Đổi kiểu trả `Promise<void>` → `Promise<string>` (range của dòng vừa thêm, vd `"Kết quả!A5:G5"`; `''` nếu API không trả):
```ts
async appendRow(
  spreadsheetId: string,
  range: string,
  values: CellValue[],
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await this.getClient().spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        includeValuesInResponse: false,
        requestBody: { values: [values] },
      });
      return res.data.updates?.updatedRange ?? '';
    } catch (err) {
      // ... giữ nguyên retry/backoff cũ ...
    }
  }
  return '';
}
```
(Caller cũ ở Discord dùng `.then(() => ...)` — vẫn chạy, giá trị trả bị bỏ qua; phase 03 sẽ dùng range.)

### 3b. updateCell — ghi đè 1 ô (cho review update Sheet)
```ts
/** Ghi đè giá trị 1 ô/range (vd "Kết quả!E5"). Có retry như appendRow. */
async updateCell(
  spreadsheetId: string,
  range: string,
  value: CellValue,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await this.getClient().spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
      });
      return;
    } catch (err) {
      const msg = (err as Error).message;
      if (attempt === MAX_RETRIES) {
        this.logger.error(`updateCell fail sau ${MAX_RETRIES} lần: ${msg}`);
        throw err;
      }
      const backoff = 500 * 2 ** (attempt - 1);
      this.logger.warn(`updateCell lỗi (lần ${attempt}), retry sau ${backoff}ms: ${msg}`);
      this.client = undefined;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}
```

## 4. Encapsulation / wiring notes
- GoogleSheetsService vẫn generic (không biết domain cột) — chỉ thao tác theo range.
- GradeService không tính điểm lẻ — chỉ map isCorrect→0/1; điểm lẻ là việc của giám thị (phase 04).

## 5. Acceptance criteria
- [ ] `npx tsc --noEmit` pass (chú ý: Discord vẫn build vì `.then()` bỏ qua giá trị trả).
- [ ] GradeOutput.questions có `type`,`earnedPoints`; GradeOutput có `totalScore`,`maxScore`.
- [ ] appendRow trả `string`; updateCell tồn tại.

## 6. Out of scope
- Không sửa Discord ở phase này (chỉ đảm bảo không vỡ build).

## 7. Commit message dự kiến
```
feat(grade,sheets): carry type/điểm câu + Sheets append-range & updateCell

GradeService trả type + earnedPoints (0/1) mỗi câu và totalScore/maxScore.
GoogleSheetsService.appendRow trả updatedRange để định vị dòng; thêm updateCell
ghi đè 1 ô (dùng khi giám thị cập nhật lại điểm). Service Sheets vẫn generic.
```
