import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

const toBoolean = ({ value }: { value: unknown }): boolean =>
  value === true || value === 'true' || value === '1';

/**
 * `FOO=` in a .env file yields an empty string, not `undefined`, and
 * `@IsOptional()` only skips `null`/`undefined` — so a blank optional variable
 * would fail its format check and break the boot. Pair this with
 * `@IsOptional()` on anything a user may legitimately leave empty.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Single source of truth for every environment variable the service reads.
 * Anything not declared here is considered unsupported configuration.
 */
export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3001;

  @IsString()
  @IsNotEmpty()
  API_PREFIX = 'api';

  @IsString()
  @IsNotEmpty()
  API_VERSION = '1';

  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS = 'http://localhost:3000';

  /* ---------------- database ---------------- */

  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT = 5432;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @Transform(toBoolean)
  @IsBoolean()
  DB_SSL = false;

  @Transform(toBoolean)
  @IsBoolean()
  DB_LOGGING = false;

  /**
   * Never enable outside local development: sequelize `sync` silently rewrites
   * schema and diverges from the migration history.
   */
  @Transform(toBoolean)
  @IsBoolean()
  DB_SYNCHRONIZE = false;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  DB_POOL_MAX = 10;

  /* ---------------- auth ---------------- */

  /**
   * Access and refresh tokens are signed with *different* secrets so a leaked
   * access secret cannot be used to mint refresh tokens.
   */
  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET!: string;

  /**
   * Short on purpose. This is the revocation window: a deactivated user, a
   * demoted role or a stolen access cookie stops working within it. The client
   * renews silently, so a small value costs the user nothing.
   */
  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET!: string;

  /**
   * How long a session survives — the "stay signed in" period. The refresh
   * cookie is rotated on every use and replaying an old one revokes the whole
   * family, so a long window is safe as long as that stays true.
   */
  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_TTL = '30d';

  @IsString()
  @IsNotEmpty()
  JWT_ISSUER = 'movieflix-api';

  @IsString()
  @IsNotEmpty()
  JWT_AUDIENCE = 'movieflix-web';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(10, { message: 'BCRYPT_ROUNDS below 10 is not acceptable for production' })
  @Max(15)
  BCRYPT_ROUNDS = 12;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(20)
  AUTH_MAX_FAILED_ATTEMPTS = 5;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  AUTH_LOCKOUT_MINUTES = 15;

  /* ---------------- cookies ---------------- */

  /** MUST be true anywhere that is not localhost. */
  @Transform(toBoolean)
  @IsBoolean()
  COOKIE_SECURE = false;

  @IsEnum(['lax', 'strict', 'none'] as const, {
    message: 'COOKIE_SAME_SITE must be lax, strict or none',
  })
  COOKIE_SAME_SITE: 'lax' | 'strict' | 'none' = 'lax';

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  COOKIE_DOMAIN?: string;

  /* ---------------- rate limiting ---------------- */

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS = 60;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 120;

  /** Deliberately low: this is the brute-force budget for /auth/login. */
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  AUTH_THROTTLE_LIMIT = 10;

  /* ---------------- object storage (Supabase) ---------------- */

  /**
   * All optional: without them the API boots normally and only *uploads*
   * fail, with a clear 503. That keeps local development working for anyone
   * who has no Supabase project.
   */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'SUPABASE_URL must be a valid URL including the protocol' },
  )
  SUPABASE_URL?: string;

  /** Legacy alias kept so an existing `.env` keeps working. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'STORAGE_URL must be a valid URL including the protocol' },
  )
  STORAGE_URL?: string;

  /**
   * Service-role key. It bypasses row-level security, so it must never reach
   * a browser — server-side only, and never behind a NEXT_PUBLIC_ prefix.
   */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  SUPABASE_SECRET_KEY?: string;

  @IsString()
  @IsNotEmpty()
  SUPABASE_STORAGE_BUCKET = 'movieflix';

  /**
   * The *upload* cap, not the stored size. Modern phone photos are routinely
   * 5-9MB and are re-encoded down to a few hundred KB before they are stored,
   * so a tight cap here only rejects legitimate files. It still bounds the
   * per-request buffer, which is what it exists for.
   */
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  UPLOAD_MAX_FILE_SIZE_MB = 10;

  /* ---------------- image optimisation ---------------- */

  /**
   * Uploads are re-encoded before they are stored. `webp` is the default
   * because it is ~25-35% smaller than JPEG at matching visual quality and is
   * supported by every browser this app targets. `original` keeps the source
   * format and only recompresses.
   */
  @IsEnum(['webp', 'avif', 'original'] as const, {
    message: 'IMAGE_TARGET_FORMAT must be webp, avif or original',
  })
  IMAGE_TARGET_FORMAT: 'webp' | 'avif' | 'original' = 'webp';

  /**
   * 82 is the usual "visually lossless" point for WebP: artefacts are not
   * detectable side by side, but the file is a fraction of the size. Going
   * above ~90 costs a lot of bytes for no perceptible gain.
   */
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(40)
  @Max(100)
  IMAGE_QUALITY = 82;

  /** Bounding box. A poster never needs to be larger than this on screen. */
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(64)
  @Max(8000)
  IMAGE_MAX_WIDTH = 1280;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(64)
  @Max(8000)
  IMAGE_MAX_HEIGHT = 1920;

  /* ---------------- observability ---------------- */

  @IsOptional()
  @IsString()
  LOG_LEVEL = 'log';

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED = true;

  @IsString()
  @IsNotEmpty()
  SWAGGER_PATH = 'docs';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
    excludeExtraneousValues: false,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return validated;
}
