import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { GoogleSheetsModule } from '../shared/google-sheets/google-sheets.module';
import { GoogleDriveModule } from '../shared/google-drive/google-drive.module';
import { QuizModule } from '../quiz/quiz.module';
import { GradeModule } from '../grade/grade.module';

@Module({
  imports: [GoogleSheetsModule, GoogleDriveModule, QuizModule, GradeModule],
  providers: [DiscordService],
})
export class DiscordModule {}
