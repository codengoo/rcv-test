import { Module } from '@nestjs/common';
import { GradeService } from './grade.service';
import { GeminiModule } from '../shared/gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  providers: [GradeService],
  exports: [GradeService],
})
export class GradeModule {}
