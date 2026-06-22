import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { GeminiModule } from '../shared/gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  providers: [QuizService],
  exports: [QuizService],
})
export class QuizModule {}
