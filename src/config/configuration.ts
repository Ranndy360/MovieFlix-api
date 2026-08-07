import { registerAs } from '@nestjs/config';

import { normalizeOrigin } from '../common/cors/origin-matcher';

import { parseDatabaseUrl } from './database-url';
import { Environment } from './env.validation';

export interface AppConfig {
  env: Environment;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  corsOrigins: string[];
  logLevel: string;
  /** Budget for the readiness probe's database ping. */
  healthDbTimeoutMs: number;
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
  // Normalised on the way in: a URL pasted from a hosting dashboard carries a
  // trailing slash, and an exact string comparison would never match it.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL ?? 'log',
  healthDbTimeoutMs: num(process.env.HEALTH_DB_TIMEOUT_MS, 5000),
}));

export const databaseConfig = registerAs('database', (): DatabaseConfig => {
  // The discrete variables still win when both are present, so a deployment
  // can point at a different database than the one the platform injected.
  const url = parseDatabaseUrl(process.env.DATABASE_URL);

  return {
    host: process.env.DB_HOST ?? url?.host ?? 'localhost',
    port: process.env.DB_PORT ? num(process.env.DB_PORT, 5432) : (url?.port ?? 5432),
    username: process.env.DB_USERNAME ?? url?.username ?? 'movieflix',
    password: process.env.DB_PASSWORD ?? url?.password ?? 'movieflix',
    database: process.env.DB_NAME ?? url?.database ?? 'movieflix',
    // Managed Postgres is reached over the public internet and requires TLS;
    // the URL carries no hint of that, so default it on when a URL was used.
    ssl: process.env.DB_SSL ? bool(process.env.DB_SSL, false) : url !== null,
    logging: bool(process.env.DB_LOGGING, false),
    synchronize: bool(process.env.DB_SYNCHRONIZE, false),
    poolMax: num(process.env.DB_POOL_MAX, 10),
  };
});

export const swaggerConfig = registerAs('swagger', (): SwaggerConfig => ({
  // Off in production unless asked for. The docs describe every endpoint, its
  // payloads and its auth requirements — useful to a developer and equally
  // useful to someone probing the surface. Opting in is the safer default;
  // forgetting to opt out is not.
  enabled: bool(process.env.SWAGGER_ENABLED, process.env.NODE_ENV !== 'production'),
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
