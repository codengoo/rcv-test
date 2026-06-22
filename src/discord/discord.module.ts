import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { GoogleSheetsModule } from '../shared/google-sheets/google-sheets.module';
import { GeminiModule } from '../shared/gemini/gemini.module';
import { QuizModule } from '../quiz/quiz.module';

@Module({
  imports: [GoogleSheetsModule, GeminiModule, QuizModule],
  providers: [DiscordService],
})
export class DiscordModule {}
