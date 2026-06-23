import { Module } from '@nestjs/common';
import { GradeService } from './grade.service';
import { GeminiModule } from '../shared/gemini/gemini.module';
import { ExamModule } from '../exam/exam.module';

@Module({
  imports: [GeminiModule, ExamModule],
  providers: [GradeService],
  exports: [GradeService],
})
export class GradeModule {}
