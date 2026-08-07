import { Environment, validateEnv } from './env.validation';

const baseEnv = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_USERNAME: 'movieflix',
  DB_PASSWORD: 'movieflix',
  DB_NAME: 'movieflix_test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const result = validateEnv(baseEnv);

    expect(result.NODE_ENV).toBe(Environment.Test);
    expect(result.PORT).toBe(3001);
    expect(result.API_PREFIX).toBe('api');
    expect(result.DB_PORT).toBe(5432);
  });

  it('coerces numeric strings', () => {
    const result = validateEnv({ ...baseEnv, PORT: '8080', DB_PORT: '6543' });

    expect(result.PORT).toBe(8080);
    expect(result.DB_PORT).toBe(6543);
  });

  it('coerces boolean-ish strings', () => {
    const result = validateEnv({ ...baseEnv, DB_SSL: 'true', SWAGGER_ENABLED: '0' });

    expect(result.DB_SSL).toBe(true);
    expect(result.SWAGGER_ENABLED).toBe(false);
  });

  it('rejects a missing required variable', () => {
    const { DB_NAME: _omitted, ...withoutDbName } = baseEnv;

    expect(() => validateEnv(withoutDbName)).toThrow(/DB_NAME/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'qa' })).toThrow(/NODE_ENV/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...baseEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('fails fast listing every problem at once', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /DB_HOST[\s\S]*DB_USERNAME[\s\S]*DB_NAME/,
    );
  });

  describe('auth secrets', () => {
    it('requires an access secret', () => {
      const { JWT_ACCESS_SECRET: _omitted, ...rest } = baseEnv;

      expect(() => validateEnv(rest)).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('rejects a short secret', () => {
      expect(() => validateEnv({ ...baseEnv, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
        /at least 32 characters/,
      );
    });

    it('rejects a bcrypt cost below 10', () => {
      expect(() => validateEnv({ ...baseEnv, BCRYPT_ROUNDS: '4' })).toThrow(/BCRYPT_ROUNDS/);
    });

    it('rejects an unknown SameSite value', () => {
      expect(() => validateEnv({ ...baseEnv, COOKIE_SAME_SITE: 'sometimes' })).toThrow(
        /COOKIE_SAME_SITE/,
      );
    });

    it('treats a blank optional variable as unset', () => {
      // `SUPABASE_URL=` in a .env file is an empty string, not undefined —
      // without the transform this fails its URL check and blocks the boot.
      expect(() => validateEnv({ ...baseEnv, SUPABASE_URL: '' })).not.toThrow();
      expect(() => validateEnv({ ...baseEnv, STORAGE_URL: '   ' })).not.toThrow();
      expect(() => validateEnv({ ...baseEnv, COOKIE_DOMAIN: '' })).not.toThrow();
    });

    it('still rejects a malformed storage URL that was actually provided', () => {
      expect(() => validateEnv({ ...baseEnv, SUPABASE_URL: 'not-a-url' })).toThrow(/SUPABASE_URL/);
    });

    it('allows a self-hosted URL with no TLD', () => {
      expect(() =>
        validateEnv({ ...baseEnv, SUPABASE_URL: 'http://localhost:54321' }),
      ).not.toThrow();
    });

    it('accepts a valid storage URL', () => {
      const result = validateEnv({
        ...baseEnv,
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SECRET_KEY: 'sb_secret_x',
      });

      expect(result.SUPABASE_URL).toBe('https://project.supabase.co');
      expect(result.SUPABASE_STORAGE_BUCKET).toBe('movieflix');
      expect(result.IMAGE_TARGET_FORMAT).toBe('webp');
      expect(result.IMAGE_QUALITY).toBe(82);
      expect(result.UPLOAD_MAX_FILE_SIZE_MB).toBe(10);
    });

    it('defaults to a secure-by-omission auth posture', () => {
      const result = validateEnv(baseEnv);

      expect(result.BCRYPT_ROUNDS).toBe(12);
      expect(result.AUTH_MAX_FAILED_ATTEMPTS).toBe(5);
      expect(result.JWT_ACCESS_TTL).toBe('15m');
      // The session lasts a month; the access token still rotates every 15
      // minutes, which is what keeps revocation quick.
      expect(result.JWT_REFRESH_TTL).toBe('30d');
      expect(result.COOKIE_SAME_SITE).toBe('lax');
    });
  });

  describe('the database can be configured two ways', () => {
    const secrets = {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    };

    it('accepts a single DATABASE_URL, with no discrete variables', () => {
      // What a managed Postgres injects. Requiring DB_HOST here is what made
      // the container exit at boot, which the platform then reported only as
      // "container stopped".
      const result = validateEnv({
        ...secrets,
        DATABASE_URL: 'postgresql://postgres:s3cret@host.railway.app:6543/railway',
      });

      expect(result.DATABASE_URL).toContain('railway');
      expect(result.DB_HOST).toBeUndefined();
    });

    it('still accepts the discrete variables on their own', () => {
      const result = validateEnv({
        ...secrets,
        DB_HOST: 'localhost',
        DB_USERNAME: 'movieflix',
        DB_NAME: 'movieflix',
      });

      expect(result.DB_HOST).toBe('localhost');
    });

    it('names exactly what is missing when neither form is complete', () => {
      expect(() => validateEnv({ ...secrets, DB_HOST: 'localhost' })).toThrow(
        /DB_USERNAME, DB_NAME: required unless DATABASE_URL is set/,
      );
    });

    it('rejects a DATABASE_URL that will not connect', () => {
      expect(() => validateEnv({ ...secrets, DATABASE_URL: 'mysql://u:p@h:3306/app' })).toThrow(
        /DATABASE_URL: not a usable Postgres URL/,
      );
    });

    it('reports the database alongside every other problem, not after them', () => {
      // One deploy, one list. Being told about the next variable only after
      // fixing the last one is how a five-minute change takes an hour.
      let message = '';
      try {
        validateEnv({ NODE_ENV: 'test' });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toMatch(/JWT_ACCESS_SECRET/);
      expect(message).toMatch(/DB_HOST, DB_USERNAME, DB_NAME/);
    });
  });
});
