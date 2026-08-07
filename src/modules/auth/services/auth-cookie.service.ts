import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';

import type { CookieConfig } from '../../../config/configuration';
import { ACCESS_TOKEN_COOKIE, REFRESH_COOKIE_PATH, REFRESH_TOKEN_COOKIE } from '../auth.constants';

/**
 * Tokens travel in cookies, never in the response body.
 *
 * `httpOnly` puts them out of reach of any JavaScript on the page, which is the
 * one mitigation `localStorage` cannot offer: with `localStorage`, a single XSS
 * anywhere in the app exfiltrates the session. The trade is CSRF exposure,
 * which `SameSite` plus the API's explicit CORS allow-list closes off.
 */
@Injectable()
export class AuthCookieService {
  private readonly config: CookieConfig;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<CookieConfig>('cookie');
  }

  setAccessCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(ACCESS_TOKEN_COOKIE, token, this.optionsFor('/', expiresAt));
  }

  setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(REFRESH_TOKEN_COOKIE, token, this.optionsFor(REFRESH_COOKIE_PATH, expiresAt));
  }

  setAuthCookies(
    response: Response,
    access: { token: string; expiresAt: Date },
    refresh: { token: string; expiresAt: Date },
  ): void {
    this.setAccessCookie(response, access.token, access.expiresAt);
    this.setRefreshCookie(response, refresh.token, refresh.expiresAt);
  }

  /**
   * Clearing must repeat the exact path/domain/sameSite the cookie was set
   * with, or the browser quietly keeps the original.
   */
  clearAuthCookies(response: Response): void {
    const base: CookieOptions = {
      httpOnly: true,
      secure: this.config.secure,
      sameSite: this.config.sameSite,
      ...(this.config.domain ? { domain: this.config.domain } : {}),
    };

    response.clearCookie(ACCESS_TOKEN_COOKIE, { ...base, path: '/' });
    response.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
  }

  private optionsFor(path: string, expiresAt: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.secure,
      sameSite: this.config.sameSite,
      path,
      expires: expiresAt,
      ...(this.config.domain ? { domain: this.config.domain } : {}),
    };
  }
}
