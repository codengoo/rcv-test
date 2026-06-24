import { Module } from '@nestjs/common';
import { ResultsController } from './results.controller';
import { ReviewController } from './review.controller';
import { SubmissionModule } from '../submission/submission.module';
import { GoogleSheetsModule } from '../shared/google-sheets/google-sheets.module';

@Module({
  imports: [SubmissionModule, GoogleSheetsModule],
  controllers: [ResultsController, ReviewController],
})
export class ResultsModule {}
