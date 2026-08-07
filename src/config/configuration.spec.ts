import { appConfig, databaseConfig, swaggerConfig } from './configuration';
import { Environment } from './env.validation';

describe('configuration namespaces', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  describe('app', () => {
    it('falls back to development defaults when nothing is set', () => {
      delete process.env.NODE_ENV;
      delete process.env.PORT;
      delete process.env.CORS_ORIGINS;

      const config = appConfig();

      expect(config).toMatchObject({
        env: Environment.Development,
        port: 3001,
        apiPrefix: 'api',
        apiVersion: '1',
      });
      expect(config.corsOrigins).toEqual(['http://localhost:3000']);
    });

    it('splits and trims a multi-origin CORS list', () => {
      process.env.CORS_ORIGINS = 'http://localhost:3000, https://app.movieflix.test ,';

      expect(appConfig().corsOrigins).toEqual([
        'http://localhost:3000',
        'https://app.movieflix.test',
      ]);
    });

    it('parses a numeric port', () => {
      process.env.PORT = '8080';

      expect(appConfig().port).toBe(8080);
    });

    it('falls back when the port is not a number', () => {
      process.env.PORT = 'not-a-port';

      expect(appConfig().port).toBe(3001);
    });
  });

  describe('database', () => {
    it('reads every connection field from the environment', () => {
      Object.assign(process.env, {
        DB_HOST: 'db.internal',
        DB_PORT: '6543',
        DB_USERNAME: 'app',
        DB_PASSWORD: 'secret',
        DB_NAME: 'movieflix_prod',
        DB_POOL_MAX: '25',
      });

      expect(databaseConfig()).toMatchObject({
        host: 'db.internal',
        port: 6543,
        username: 'app',
        password: 'secret',
        database: 'movieflix_prod',
        poolMax: 25,
      });
    });

    it('treats "1" and "true" as true and anything else as false', () => {
      process.env.DB_SSL = '1';
      process.env.DB_LOGGING = 'true';
      process.env.DB_SYNCHRONIZE = 'no';

      const config = databaseConfig();

      expect(config.ssl).toBe(true);
      expect(config.logging).toBe(true);
      expect(config.synchronize).toBe(false);
    });

    it('defaults synchronize to false when unset', () => {
      delete process.env.DB_SYNCHRONIZE;

      expect(databaseConfig().synchronize).toBe(false);
    });
  });

  describe('swagger', () => {
    it('is enabled by default', () => {
      delete process.env.SWAGGER_ENABLED;
      delete process.env.SWAGGER_PATH;

      expect(swaggerConfig()).toEqual({ enabled: true, path: 'docs' });
    });

    it('can be disabled explicitly', () => {
      process.env.SWAGGER_ENABLED = 'false';
      process.env.SWAGGER_PATH = 'internal/docs';

      expect(swaggerConfig()).toEqual({ enabled: false, path: 'internal/docs' });
    });
  });
});
