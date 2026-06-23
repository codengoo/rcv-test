import { Module } from '@nestjs/common';
import { ResultsController } from './results.controller';
import { SubmissionModule } from '../submission/submission.module';

@Module({
  imports: [SubmissionModule],
  controllers: [ResultsController],
})
export class ResultsModule {}
