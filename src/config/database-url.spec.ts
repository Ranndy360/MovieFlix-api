import { parseDatabaseUrl } from './database-url';

describe('parseDatabaseUrl', () => {
  it('reads the shape Railway injects', () => {
    expect(
      parseDatabaseUrl(
        'postgresql://postgres:s3cret@containers-us-west-1.railway.app:6543/railway',
      ),
    ).toEqual({
      host: 'containers-us-west-1.railway.app',
      port: 6543,
      username: 'postgres',
      password: 's3cret',
      database: 'railway',
    });
  });

  it('accepts the postgres:// spelling too', () => {
    expect(parseDatabaseUrl('postgres://u:p@db.internal:5432/app')?.database).toBe('app');
  });

  it('defaults the port when the URL omits it', () => {
    expect(parseDatabaseUrl('postgresql://u:p@db.internal/app')?.port).toBe(5432);
  });

  it('decodes a password with URL-unsafe characters', () => {
    // Generated passwords contain these routinely, and a raw read would
    // silently connect with the wrong credentials.
    const parsed = parseDatabaseUrl('postgresql://u%40corp:p%40ss%2Fword@host:5432/app');

    expect(parsed?.username).toBe('u@corp');
    expect(parsed?.password).toBe('p@ss/word');
  });

  it('tolerates an empty password', () => {
    expect(parseDatabaseUrl('postgresql://postgres@localhost:5432/app')?.password).toBe('');
  });

  describe('values it refuses', () => {
    it.each([
      ['undefined', undefined],
      ['empty', ''],
      ['not a URL', 'localhost:5432'],
      ['wrong protocol', 'mysql://u:p@host:3306/app'],
      ['no database', 'postgresql://u:p@host:5432'],
      ['no database, trailing slash', 'postgresql://u:p@host:5432/'],
    ])('%s', (_label, value) => {
      expect(parseDatabaseUrl(value)).toBeNull();
    });

    it('returns null instead of throwing, so the env report stays readable', () => {
      expect(() => parseDatabaseUrl('://///')).not.toThrow();
      expect(parseDatabaseUrl('://///')).toBeNull();
    });
  });
});
