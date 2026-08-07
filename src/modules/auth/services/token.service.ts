import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';

import type { AuthConfig } from '../../../config/configuration';
import type { RoleName } from '../../roles/entities/role.entity';
import { TOKEN_TYPE, type AccessTokenPayload, type RefreshTokenPayload } from '../auth.constants';

/**
 * `@nestjs/jwt` types `expiresIn` as a template-literal duration (`ms` format),
 * which a plain `string` from the environment cannot satisfy structurally.
 * The value is validated as a non-empty string at boot, so narrowing it here
 * is safe — and a malformed duration makes `signAsync` throw immediately.
 */
type JwtDuration = Exclude<JwtSignOptions['expiresIn'], undefined>;

const asDuration = (value: string): JwtDuration => value as JwtDuration;

export interface IssuedToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

export interface TokenSubject {
  id: string;
  email: string;
  role: RoleName;
}

@Injectable()
export class TokenService {
  private readonly config: AuthConfig;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  async issueAccessToken(user: TokenSubject): Promise<IssuedToken> {
    const jti = randomUUID();

    const token = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role, type: TOKEN_TYPE.Access },
      {
        jwtid: jti,
        secret: this.config.accessSecret,
        expiresIn: asDuration(this.config.accessTtl),
        issuer: this.config.issuer,
        audience: this.config.audience,
      },
    );

    return { token, jti, expiresAt: this.expiryOf(token) };
  }

  async issueRefreshToken(userId: string): Promise<IssuedToken> {
    const jti = randomUUID();

    const token = await this.jwtService.signAsync(
      { sub: userId, type: TOKEN_TYPE.Refresh },
      {
        jwtid: jti,
        secret: this.config.refreshSecret,
        expiresIn: asDuration(this.config.refreshTtl),
        issuer: this.config.issuer,
        audience: this.config.audience,
      },
    );

    return { token, jti, expiresAt: this.expiryOf(token) };
  }

  /**
   * Verifies signature, expiry, issuer and audience — then checks the `type`
   * claim so an access token can never be replayed as a refresh token.
   */
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.refreshSecret,
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (payload.type !== TOKEN_TYPE.Refresh || !payload.jti || !payload.sub) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return payload;
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.accessSecret,
      issuer: this.config.issuer,
      audience: this.config.audience,
    });

    if (payload.type !== TOKEN_TYPE.Access) {
      throw new UnauthorizedException('Invalid token');
    }

    return payload;
  }

  /**
   * Only the SHA-256 digest of a refresh token is persisted, so a database leak
   * does not hand over usable sessions. SHA-256 (not bcrypt) is right here: the
   * input is 256 bits of entropy, not a guessable password, and refresh has to
   * stay fast.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private expiryOf(token: string): Date {
    // `decode` is typed loosely; narrow before trusting the claim.
    const decoded: unknown = this.jwtService.decode(token);
    const exp = (decoded as { exp?: unknown } | null)?.exp;

    if (typeof exp !== 'number') {
      throw new Error('Signed token is missing an exp claim');
    }

    return new Date(exp * 1000);
  }
}
