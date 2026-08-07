import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';

import type { AuthConfig } from '../../../config/configuration';
import { UsersService } from '../../users/users.service';
import {
  ACCESS_TOKEN_COOKIE,
  TOKEN_TYPE,
  type AccessTokenPayload,
  type AuthenticatedUser,
} from '../auth.constants';

/** Reads the access token from our httpOnly cookie. */
const fromAuthCookie = (request: Request): string | null => {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const auth = configService.getOrThrow<AuthConfig>('auth');

    const options: StrategyOptionsWithoutRequest = {
      // Cookie first (browsers), bearer second (server-to-server, tests).
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromAuthCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: auth.accessSecret,
      issuer: auth.issuer,
      audience: auth.audience,
    };

    super(options);
  }

  /**
   * Runs on every authenticated request, after the signature checks out.
   *
   * It deliberately re-reads the user: a token stays cryptographically valid
   * until it expires, so without this check a deactivated, deleted, demoted or
   * password-reset account would keep full access for the rest of the window.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.type !== TOKEN_TYPE.Access) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findActiveById(payload.sub);

    if (!user || !user.role) {
      throw new UnauthorizedException();
    }

    // Tokens minted before the last password change are dead.
    const issuedAtMs = payload.iat * 1000;
    if (issuedAtMs < Math.floor(user.passwordChangedAt.getTime() / 1000) * 1000) {
      throw new UnauthorizedException();
    }

    return {
      id: user.id,
      email: user.email,
      // Read from the database, never from the token: a role change must take
      // effect immediately, not when the access token happens to expire.
      role: user.role.name,
      tokenId: payload.jti,
    };
  }
}
