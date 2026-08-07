import { registerAs } from '@nestjs/config';

import { Environment } from './env.validation';

export interface AppConfig {
  env: Environment;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  corsOrigins: string[];
  logLevel: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  logging: boolean;
  synchronize: boolean;
  poolMax: number;
}

export interface SwaggerConfig {
  enabled: boolean;
  path: string;
}

export interface AuthConfig {
  accessSecret: string;
  accessTtl: string;
  refreshSecret: string;
  refreshTtl: string;
  issuer: string;
  audience: string;
  bcryptRounds: number;
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

export interface CookieConfig {
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  domain: string | undefined;
}

export type ImageTargetFormat = 'webp' | 'avif' | 'original';

export interface ImageConfig {
  targetFormat: ImageTargetFormat;
  quality: number;
  maxWidth: number;
  maxHeight: number;
}

export interface StorageConfig {
  /** `undefined` when Supabase is not configured — uploads then 503. */
  url: string | undefined;
  secretKey: string | undefined;
  bucket: string;
  maxFileSizeBytes: number;
  /** Top-level folder inside the bucket, one per environment. */
  environmentFolder: string;
  isConfigured: boolean;
  image: ImageConfig;
}

export interface ThrottleConfig {
  ttlSeconds: number;
  limit: number;
  authLimit: number;
}

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === 'true' || value === '1';

export const appConfig = registerAs('app', (): AppConfig => ({
  env: (process.env.NODE_ENV as Environment | undefined) ?? Environment.Development,
  port: num(process.env.PORT, 3001),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  apiVersion: process.env.API_VERSION ?? '1',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL ?? 'log',
}));

export const databaseConfig = registerAs('database', (): DatabaseConfig => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: num(process.env.DB_PORT, 5432),
  username: process.env.DB_USERNAME ?? 'movieflix',
  password: process.env.DB_PASSWORD ?? 'movieflix',
  database: process.env.DB_NAME ?? 'movieflix',
  ssl: bool(process.env.DB_SSL, false),
  logging: bool(process.env.DB_LOGGING, false),
  synchronize: bool(process.env.DB_SYNCHRONIZE, false),
  poolMax: num(process.env.DB_POOL_MAX, 10),
}));

export const swaggerConfig = registerAs('swagger', (): SwaggerConfig => ({
  enabled: bool(process.env.SWAGGER_ENABLED, true),
  path: process.env.SWAGGER_PATH ?? 'docs',
}));

export const authConfig = registerAs('auth', (): AuthConfig => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  issuer: process.env.JWT_ISSUER ?? 'movieflix-api',
  audience: process.env.JWT_AUDIENCE ?? 'movieflix-web',
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  maxFailedAttempts: num(process.env.AUTH_MAX_FAILED_ATTEMPTS, 5),
  lockoutMinutes: num(process.env.AUTH_LOCKOUT_MINUTES, 15),
}));

export const cookieConfig = registerAs('cookie', (): CookieConfig => ({
  secure: bool(process.env.COOKIE_SECURE, false),
  sameSite: (process.env.COOKIE_SAME_SITE as CookieConfig['sameSite'] | undefined) ?? 'lax',
  domain: process.env.COOKIE_DOMAIN || undefined,
}));

export const storageConfig = registerAs('storage', (): StorageConfig => {
  // Accept the legacy STORAGE_URL name so an existing .env keeps working.
  const url = process.env.SUPABASE_URL || process.env.STORAGE_URL || undefined;
  const secretKey = process.env.SUPABASE_SECRET_KEY || undefined;

  return {
    url,
    secretKey,
    bucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'movieflix',
    maxFileSizeBytes: num(process.env.UPLOAD_MAX_FILE_SIZE_MB, 10) * 1024 * 1024,
    // Every object is namespaced by environment, so a staging upload can never
    // overwrite or be mistaken for a production one inside a shared bucket.
    environmentFolder: process.env.NODE_ENV ?? Environment.Development,
    isConfigured: Boolean(url && secretKey),
    image: {
      targetFormat: (process.env.IMAGE_TARGET_FORMAT as ImageTargetFormat | undefined) ?? 'webp',
      quality: num(process.env.IMAGE_QUALITY, 82),
      maxWidth: num(process.env.IMAGE_MAX_WIDTH, 1280),
      maxHeight: num(process.env.IMAGE_MAX_HEIGHT, 1920),
    },
  };
});

export const throttleConfig = registerAs('throttle', (): ThrottleConfig => ({
  ttlSeconds: num(process.env.THROTTLE_TTL_SECONDS, 60),
  limit: num(process.env.THROTTLE_LIMIT, 120),
  authLimit: num(process.env.AUTH_THROTTLE_LIMIT, 10),
}));

export const configurations = [
  appConfig,
  databaseConfig,
  swaggerConfig,
  authConfig,
  cookieConfig,
  storageConfig,
  throttleConfig,
];
