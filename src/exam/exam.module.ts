import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Exam, ExamSchema } from './exam.schema';
import { ExamService } from './exam.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Exam.name, schema: ExamSchema }]),
  ],
  providers: [ExamService],
  exports: [ExamService],
})
export class ExamModule {}
