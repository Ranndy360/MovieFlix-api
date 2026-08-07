import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';

import { ACCESS_TOKEN_COOKIE, REFRESH_COOKIE_PATH, REFRESH_TOKEN_COOKIE } from '../auth.constants';
import { AuthCookieService } from './auth-cookie.service';

interface CookieCall {
  name: string;
  value: string;
  options: CookieOptions;
}

const buildResponse = (): { response: Response; cookie: jest.Mock; clearCookie: jest.Mock } => {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return { response: { cookie, clearCookie } as unknown as Response, cookie, clearCookie };
};

const callsOf = (mock: jest.Mock): CookieCall[] =>
  mock.mock.calls.map(([name, value, options]: [string, string, CookieOptions]) => ({
    name,
    value,
    options,
  }));

type CookieConfigOverrides = Partial<{
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  domain: string | undefined;
}>;

const build = (overrides: CookieConfigOverrides = {}): AuthCookieService =>
  new AuthCookieService({
    getOrThrow: () => ({ secure: false, sameSite: 'lax', domain: undefined, ...overrides }),
  } as unknown as ConfigService);

const access = { token: 'access.jwt', expiresAt: new Date(Date.now() + 900_000) };
const refresh = { token: 'refresh.jwt', expiresAt: new Date(Date.now() + 604_800_000) };

describe('AuthCookieService', () => {
  it('marks both cookies httpOnly — unreadable from JavaScript', () => {
    const { response, cookie } = buildResponse();

    build().setAuthCookies(response, access, refresh);

    expect(callsOf(cookie)).toHaveLength(2);
    callsOf(cookie).forEach(({ options }) => expect(options.httpOnly).toBe(true));
  });

  it('scopes the refresh cookie to the auth routes only', () => {
    const { response, cookie } = buildResponse();

    build().setAuthCookies(response, access, refresh);

    const [accessCookie, refreshCookie] = callsOf(cookie);
    expect(accessCookie?.name).toBe(ACCESS_TOKEN_COOKIE);
    expect(accessCookie?.options.path).toBe('/');
    expect(refreshCookie?.name).toBe(REFRESH_TOKEN_COOKIE);
    // Narrower path = the browser never sends it to ordinary endpoints.
    expect(refreshCookie?.options.path).toBe(REFRESH_COOKIE_PATH);
  });

  it('applies the configured SameSite policy', () => {
    const { response, cookie } = buildResponse();

    build({ sameSite: 'strict' }).setAuthCookies(response, access, refresh);

    callsOf(cookie).forEach(({ options }) => expect(options.sameSite).toBe('strict'));
  });

  it('sets Secure when configured for production', () => {
    const { response, cookie } = buildResponse();

    build({ secure: true }).setAuthCookies(response, access, refresh);

    callsOf(cookie).forEach(({ options }) => expect(options.secure).toBe(true));
  });

  it('omits the domain attribute when none is configured', () => {
    const { response, cookie } = buildResponse();

    build().setAuthCookies(response, access, refresh);

    callsOf(cookie).forEach(({ options }) => expect(options).not.toHaveProperty('domain'));
  });

  it('includes the domain when one is configured', () => {
    const { response, cookie } = buildResponse();

    build({ domain: '.movieflix.test' }).setAuthCookies(response, access, refresh);

    callsOf(cookie).forEach(({ options }) => expect(options.domain).toBe('.movieflix.test'));
  });

  it('gives each cookie its own expiry', () => {
    const { response, cookie } = buildResponse();

    build().setAuthCookies(response, access, refresh);

    const [accessCookie, refreshCookie] = callsOf(cookie);
    expect(accessCookie?.options.expires).toBe(access.expiresAt);
    expect(refreshCookie?.options.expires).toBe(refresh.expiresAt);
  });

  it('clears both cookies with matching path and flags', () => {
    const { response, clearCookie } = buildResponse();

    build({ domain: '.movieflix.test', sameSite: 'strict', secure: true }).clearAuthCookies(
      response,
    );

    const cleared = clearCookie.mock.calls as [string, CookieOptions][];
    expect(cleared.map(([name]) => name)).toEqual([ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]);

    // A mismatched path/domain silently leaves the original cookie in place.
    expect(cleared[0]?.[1]).toMatchObject({
      path: '/',
      domain: '.movieflix.test',
      sameSite: 'strict',
      secure: true,
      httpOnly: true,
    });
    expect(cleared[1]?.[1]).toMatchObject({ path: REFRESH_COOKIE_PATH });
  });
});
