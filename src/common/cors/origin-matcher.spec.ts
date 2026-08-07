import { isOriginAllowed, normalizeOrigin } from './origin-matcher';

describe('normalizeOrigin', () => {
  it.each([
    ['https://app.example.com', 'https://app.example.com'],
    ['https://app.example.com/', 'https://app.example.com'],
    ['  https://app.example.com//  ', 'https://app.example.com'],
    ['HTTPS://App.Example.COM', 'https://app.example.com'],
    ['https://app.example.com/some/path', 'https://app.example.com'],
    ['https://app.example.com:8443', 'https://app.example.com:8443'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it('drops the default port, the way a browser does when it sends Origin', () => {
    expect(normalizeOrigin('https://app.example.com:443')).toBe('https://app.example.com');
  });

  it('returns an empty string for nothing', () => {
    expect(normalizeOrigin('   ')).toBe('');
  });
});

describe('isOriginAllowed', () => {
  const allowList = ['https://moviefix.vercel.app'];

  it('accepts an exact match', () => {
    expect(isOriginAllowed('https://moviefix.vercel.app', allowList)).toBe(true);
  });

  /** The single most common misconfiguration, and it used to fail silently. */
  it('tolerates a trailing slash on either side', () => {
    expect(isOriginAllowed('https://moviefix.vercel.app/', allowList)).toBe(true);
    expect(isOriginAllowed('https://moviefix.vercel.app', ['https://moviefix.vercel.app/'])).toBe(
      true,
    );
  });

  it('ignores case', () => {
    expect(isOriginAllowed('https://MovieFix.Vercel.App', allowList)).toBe(true);
  });

  it('rejects a different host', () => {
    expect(isOriginAllowed('https://evil.example.com', allowList)).toBe(false);
  });

  it('rejects the same host over plain http', () => {
    expect(isOriginAllowed('http://moviefix.vercel.app', allowList)).toBe(false);
  });

  it('rejects everything when the list is empty', () => {
    expect(isOriginAllowed('https://moviefix.vercel.app', [])).toBe(false);
  });

  describe('wildcards, for preview deployments', () => {
    const previews = ['https://*.vercel.app'];

    it('matches a generated preview hostname', () => {
      expect(isOriginAllowed('https://moviefix-git-main-ranndy.vercel.app', previews)).toBe(true);
    });

    /**
     * The wildcard covers one label and stops at the dot. Without that, anyone
     * able to create `attacker.vercel.app` — which is to say anyone — would be
     * inside the allow-list of every API that used a loose pattern.
     */
    it('does not span a dot', () => {
      expect(isOriginAllowed('https://a.b.vercel.app', previews)).toBe(false);
    });

    it('still pins the scheme', () => {
      expect(isOriginAllowed('http://preview.vercel.app', previews)).toBe(false);
    });

    it('does not match the bare apex', () => {
      expect(isOriginAllowed('https://vercel.app', previews)).toBe(false);
    });

    it('treats the rest of the pattern literally', () => {
      // The dots are escaped, so `.` must be a dot and not any character.
      expect(isOriginAllowed('https://preview.vercelXapp', previews)).toBe(false);
    });
  });

  it('accepts any entry in a multi-origin list', () => {
    const list = ['https://moviefix.vercel.app', 'https://*.vercel.app', 'http://localhost:3000'];

    expect(isOriginAllowed('http://localhost:3000', list)).toBe(true);
    expect(isOriginAllowed('https://feature-x.vercel.app', list)).toBe(true);
    expect(isOriginAllowed('http://localhost:3001', list)).toBe(false);
  });
});
