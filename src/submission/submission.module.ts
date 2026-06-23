import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Submission, SubmissionSchema } from './submission.schema';
import { SubmissionService } from './submission.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Submission.name, schema: SubmissionSchema },
    ]),
  ],
  providers: [SubmissionService],
  exports: [SubmissionService],
})
export class SubmissionModule {}
