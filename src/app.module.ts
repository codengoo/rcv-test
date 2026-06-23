import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { DiscordModule } from './discord/discord.module';
import { ResultsModule } from './results/results.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    // Rate-limit toàn cục (mặc định nới); /unlock siết riêng bằng @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    // Phục vụ React build (phase 05). Không chặn /api (controller xử lý).
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'web', 'dist'),
      exclude: ['/api/{*splat}'],
    }),
    DiscordModule,
    ResultsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
