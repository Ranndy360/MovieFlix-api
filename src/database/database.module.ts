import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';

import type { AppConfig, DatabaseConfig } from '../config/configuration';
import { Environment } from '../config/env.validation';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { Movie } from '../modules/movies/entities/movie.entity';
import { Review } from '../modules/reviews/entities/review.entity';
import { Role } from '../modules/roles/entities/role.entity';
import { User } from '../modules/users/entities/user.entity';
import { WatchlistEntry } from '../modules/watchlist/entities/watchlist-entry.entity';

/**
 * Every model must be registered here. `autoLoadModels` is intentionally not
 * used: an explicit list makes the schema surface reviewable in one place.
 */
export const MODELS = [Role, User, RefreshToken, Movie, WatchlistEntry, Review];

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const db = configService.getOrThrow<DatabaseConfig>('database');
        const app = configService.getOrThrow<AppConfig>('app');
        const sqlLogger = new Logger('Sequelize');

        return {
          dialect: 'postgres' as const,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          models: MODELS,
          // Schema changes go through migrations only — see CLAUDE.md.
          synchronize: db.synchronize && app.env === Environment.Development,
          autoLoadModels: false,
          logging: db.logging ? (sql: string) => sqlLogger.debug(sql) : false,
          benchmark: db.logging,
          pool: {
            max: db.poolMax,
            min: 0,
            acquire: 30_000,
            idle: 10_000,
          },
          define: {
            underscored: true,
            timestamps: true,
            paranoid: false,
            freezeTableName: false,
          },
          dialectOptions: db.ssl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
          retry: { max: 3 },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
