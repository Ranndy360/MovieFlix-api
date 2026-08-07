import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { timingSafeEqual } from 'node:crypto';

import type { AuthConfig } from '../../config/configuration';
import { SIGNUP_ROLE } from '../roles/entities/role.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import type { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import type { RequestContext } from './auth.constants';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordService } from './services/password.service';
import { TokenService, type IssuedToken } from './services/token.service';

/** Everything the controller needs to answer a successful auth call. */
export interface AuthResult {
  user: UserResponseDto;
  access: IssuedToken;
  refresh: IssuedToken;
}

/** One generic message for every credential failure — see `login`. */
const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly config: AuthConfig;

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    @InjectModel(RefreshToken) private readonly refreshTokenModel: typeof RefreshToken,
    configService: ConfigService,
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  /**
   * Self-service signup. The role is hard-coded to `USER`; there is no code
   * path here that can produce an ADMIN or PROVIDER.
   */
  async register(dto: RegisterDto, context: RequestContext): Promise<AuthResult> {
    if (await this.usersService.emailExists(dto.email)) {
      // Signup cannot avoid confirming that an address is taken — the
      // alternative (pretending to succeed) breaks the product. The mitigation
      // is rate limiting on this endpoint, not a vague error.
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      roleName: SIGNUP_ROLE,
    });

    this.logger.log(`Registered ${user.email} as ${SIGNUP_ROLE}`);

    return this.startSession(user, context);
  }

  /**
   * The check order here is deliberate and security-relevant.
   *
   * The password is verified *first*, even for a locked or disabled account.
   * Only after it matches do we disclose "locked" or "disabled" — at that point
   * the caller already knows the password, so the extra detail leaks nothing,
   * and a legitimate user gets a message they can act on. Checking the lock
   * first would turn the endpoint into an account-existence oracle.
   *
   * Every failure returns the same message and the same 401.
   */
  async login(dto: LoginDto, context: RequestContext): Promise<AuthResult> {
    const user = await this.usersService.findByEmailWithSecrets(dto.email);

    if (!user) {
      // Equalize timing against the "user exists" branch.
      await this.passwordService.compareWithDummy(dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const passwordMatches = await this.passwordService.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      if (!user.isLocked()) {
        await this.usersService.registerFailedLogin(
          user,
          this.config.maxFailedAttempts,
          this.config.lockoutMinutes,
        );
      }
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.isLocked()) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((user.lockedUntil as Date).getTime() - Date.now()) / 1000),
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many failed attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
          error: 'Account Locked',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException('This account has been disabled');
    }

    await this.usersService.registerSuccessfulLogin(user);

    this.logger.log(`Login ${user.email}`);

    return this.startSession(user, context);
  }

  /**
   * Refresh-token rotation with reuse detection.
   *
   * Each refresh consumes its token and issues a new pair. If a token that was
   * already rotated comes back, the only explanations are theft or a replay —
   * so every session for that user is revoked immediately.
   */
  async refresh(rawToken: string | undefined, context: RequestContext): Promise<AuthResult> {
    if (!rawToken) {
      throw new UnauthorizedException('No active session');
    }

    const payload = await this.tokenService.verifyRefreshToken(rawToken);
    const stored = await this.refreshTokenModel.findOne({ where: { jti: payload.jti } });

    if (!stored) {
      // Signed correctly but unknown to us: the row was pruned, or the secret
      // leaked. Either way, refuse.
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (stored.isRevoked) {
      this.logger.error(
        `Refresh token reuse detected for user ${stored.userId} (jti ${stored.jti}) — revoking all sessions`,
      );
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (stored.isExpired()) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (!this.hashesMatch(this.tokenService.hashToken(rawToken), stored.tokenHash)) {
      this.logger.error(`Refresh token hash mismatch for user ${stored.userId}`);
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Invalid or expired session');
    }

    const user = await this.usersService.findActiveById(payload.sub);

    if (!user) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Invalid or expired session');
    }

    const result = await this.startSession(user, context);

    // Rotate: retire the presented token and link it to its successor so the
    // chain stays auditable.
    await stored.update({ revokedAt: new Date(), replacedByJti: result.refresh.jti });

    return result;
  }

  /** Ends one session. Idempotent: an unknown or absent token is not an error. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;

    try {
      const payload = await this.tokenService.verifyRefreshToken(rawToken);
      await this.refreshTokenModel.update(
        { revokedAt: new Date() },
        { where: { jti: payload.jti, revokedAt: null } },
      );
    } catch {
      // Logging out with a junk token still means "you are logged out".
    }
  }

  /** Ends every session for a user — "sign out everywhere". */
  async logoutAll(userId: string): Promise<number> {
    return this.revokeAllForUser(userId);
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findActiveById(userId);

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    return UserResponseDto.fromEntity(user);
  }

  /** Drops rows that can no longer be used. Driven by `RefreshTokenCleanupService`. */
  async pruneExpiredTokens(now: Date = new Date()): Promise<number> {
    return this.refreshTokenModel.destroy({
      where: { [Op.or]: [{ expiresAt: { [Op.lt]: now } }, { revokedAt: { [Op.ne]: null } }] },
    });
  }

  /* ---------------- internals ---------------- */

  private async startSession(user: User, context: RequestContext): Promise<AuthResult> {
    if (!user.role) {
      throw new Error('User.role must be loaded before starting a session');
    }

    const access = await this.tokenService.issueAccessToken({
      id: user.id,
      email: user.email,
      role: user.role.name,
    });

    const refresh = await this.tokenService.issueRefreshToken(user.id);

    await this.refreshTokenModel.create({
      userId: user.id,
      jti: refresh.jti,
      tokenHash: this.tokenService.hashToken(refresh.token),
      expiresAt: refresh.expiresAt,
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      ipAddress: context.ipAddress?.slice(0, 64) ?? null,
    });

    return { user: UserResponseDto.fromEntity(user), access, refresh };
  }

  private async revokeAllForUser(userId: string): Promise<number> {
    const [affected] = await this.refreshTokenModel.update(
      { revokedAt: new Date() },
      { where: { userId, revokedAt: null } },
    );

    return affected;
  }

  /** Constant-time comparison, so hash checking cannot be probed byte by byte. */
  private hashesMatch(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');

    if (left.length !== right.length) return false;

    return timingSafeEqual(left, right);
  }
}
