import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { GeminiModule } from '../shared/gemini/gemini.module';
import { ExamModule } from '../exam/exam.module';

@Module({
  imports: [GeminiModule, ExamModule],
  providers: [QuizService],
  exports: [QuizService],
})
export class QuizModule {}
