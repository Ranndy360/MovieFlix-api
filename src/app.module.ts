import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { configurations, type ThrottleConfig } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { MoviesModule } from './modules/movies/movies.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { UsersModule } from './modules/users/users.module';
import { WatchlistModule } from './modules/watchlist/watchlist.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: configurations,
      validate: validateEnv,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const throttle = configService.getOrThrow<ThrottleConfig>('throttle');
        return {
          throttlers: [{ name: 'default', ttl: throttle.ttlSeconds * 1000, limit: throttle.limit }],
        };
      },
    }),

    DatabaseModule,
    HealthModule,

    /* ---- feature modules ---- */
    AuthModule,
    UsersModule,
    MoviesModule,
    WatchlistModule,
    ReviewsModule,
    ProfileModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },

    /**
     * Guard order is the registration order, and it matters:
     *   1. Throttler  — cheapest rejection first; shields the rest from floods.
     *   2. JwtAuthGuard — populates `request.user` (deny-by-default; `@Public()` opts out).
     *   3. RolesGuard   — needs `request.user`, so it must come after.
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
