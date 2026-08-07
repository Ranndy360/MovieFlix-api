import {
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/sequelize';
import { Test, type TestingModule } from '@nestjs/testing';

import { seedFaker } from '../../testing/factory';
import { RoleName } from '../roles/entities/role.entity';
import { UsersService } from '../users/users.service';
import {
  asUser,
  buildAdminStub,
  buildUserStub,
  type UserStub,
} from '../users/testing/user.factory';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import {
  asRefreshToken,
  buildExpiredRefreshTokenStub,
  buildRefreshTokenStub,
  buildRevokedRefreshTokenStub,
  type RefreshTokenStub,
} from './testing/refresh-token.factory';

const AUTH_CONFIG = {
  accessSecret: 'a'.repeat(32),
  accessTtl: '15m',
  refreshSecret: 'b'.repeat(32),
  refreshTtl: '7d',
  issuer: 'movieflix-api',
  audience: 'movieflix-web',
  bcryptRounds: 12,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

const CONTEXT = { userAgent: 'jest', ipAddress: '127.0.0.1' };

const issuedAccess = {
  token: 'access.jwt',
  jti: 'access-jti',
  expiresAt: new Date(Date.now() + 900_000),
};
const issuedRefresh = {
  token: 'refresh.jwt',
  jti: 'refresh-jti',
  expiresAt: new Date(Date.now() + 604_800_000),
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      | 'emailExists'
      | 'create'
      | 'findByEmailWithSecrets'
      | 'findActiveById'
      | 'registerFailedLogin'
      | 'registerSuccessfulLogin'
    >
  >;
  let passwordService: jest.Mocked<Pick<PasswordService, 'hash' | 'compare' | 'compareWithDummy'>>;
  let tokenService: jest.Mocked<
    Pick<
      TokenService,
      'issueAccessToken' | 'issueRefreshToken' | 'verifyRefreshToken' | 'hashToken'
    >
  >;
  let refreshTokenModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    destroy: jest.Mock;
  };

  beforeEach(async () => {
    seedFaker();

    usersService = {
      emailExists: jest.fn().mockResolvedValue(false),
      create: jest.fn(),
      findByEmailWithSecrets: jest.fn(),
      findActiveById: jest.fn(),
      registerFailedLogin: jest.fn().mockResolvedValue(undefined),
      registerSuccessfulLogin: jest.fn().mockResolvedValue(undefined),
    };

    passwordService = {
      hash: jest.fn().mockResolvedValue('$2b$12$hashed'),
      compare: jest.fn(),
      compareWithDummy: jest.fn().mockResolvedValue(false),
    };

    tokenService = {
      issueAccessToken: jest.fn().mockResolvedValue(issuedAccess),
      issueRefreshToken: jest.fn().mockResolvedValue(issuedRefresh),
      verifyRefreshToken: jest.fn(),
      // Hex-encoded so the digest genuinely cannot contain the plaintext —
      // otherwise the "never stores the raw token" assertion proves nothing.
      hashToken: jest.fn((token: string) => Buffer.from(token).toString('hex')),
    };

    refreshTokenModel = {
      create: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue([1]),
      destroy: jest.fn().mockResolvedValue(0),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokenService, useValue: tokenService },
        { provide: getModelToken(RefreshToken), useValue: refreshTokenModel },
        { provide: ConfigService, useValue: { getOrThrow: () => AUTH_CONFIG } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  const registerDto = {
    email: 'ada@test.io',
    password: 'Str0ng!Passw0rd',
    firstName: 'Ada',
    lastName: 'Lovelace',
  };

  const loginDto = { email: 'ada@test.io', password: 'Str0ng!Passw0rd' };

  describe('register', () => {
    it('always creates the account with the USER role', async () => {
      usersService.create.mockResolvedValue(asUser(buildUserStub({ email: registerDto.email })));

      await service.register(registerDto, CONTEXT);

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ roleName: RoleName.User }),
      );
    });

    it('never lets a caller pick a privileged role', async () => {
      usersService.create.mockResolvedValue(asUser(buildAdminStub()));

      // Even a payload that smuggled `role` past the DTO cannot reach create().
      await service.register({ ...registerDto, role: RoleName.Admin } as never, CONTEXT);

      const call = usersService.create.mock.calls[0][0] as { roleName: RoleName };
      expect(call.roleName).toBe(RoleName.User);
      expect(call.roleName).not.toBe(RoleName.Admin);
    });

    it('stores a hash, never the plaintext password', async () => {
      usersService.create.mockResolvedValue(asUser(buildUserStub()));

      await service.register(registerDto, CONTEXT);

      expect(passwordService.hash).toHaveBeenCalledWith(registerDto.password);
      const call = usersService.create.mock.calls[0][0] as { passwordHash: string };
      expect(call.passwordHash).toBe('$2b$12$hashed');
      expect(JSON.stringify(call)).not.toContain(registerDto.password);
    });

    it('rejects a duplicate email', async () => {
      usersService.emailExists.mockResolvedValue(true);

      await expect(service.register(registerDto, CONTEXT)).rejects.toThrow(ConflictException);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('persists the refresh token as a hash, not the raw value', async () => {
      usersService.create.mockResolvedValue(asUser(buildUserStub()));

      await service.register(registerDto, CONTEXT);

      const row = refreshTokenModel.create.mock.calls[0][0] as { tokenHash: string };
      expect(row.tokenHash).toBe(Buffer.from(issuedRefresh.token).toString('hex'));
      expect(JSON.stringify(row)).not.toContain(issuedRefresh.token);
    });

    it('returns no tokens in the payload', async () => {
      usersService.create.mockResolvedValue(asUser(buildUserStub()));

      const result = await service.register(registerDto, CONTEXT);

      expect(Object.keys(result.user)).not.toContain('passwordHash');
      expect(result.access.token).toBe(issuedAccess.token);
    });
  });

  describe('login', () => {
    it('issues a session for valid credentials', async () => {
      const user = buildUserStub({ email: loginDto.email });
      usersService.findByEmailWithSecrets.mockResolvedValue(asUser(user));
      passwordService.compare.mockResolvedValue(true);

      const result = await service.login(loginDto, CONTEXT);

      expect(result.user.email).toBe(loginDto.email);
      expect(usersService.registerSuccessfulLogin).toHaveBeenCalledWith(user);
    });

    it('burns equivalent time when the email is unknown', async () => {
      usersService.findByEmailWithSecrets.mockResolvedValue(null);

      await expect(service.login(loginDto, CONTEXT)).rejects.toThrow(UnauthorizedException);
      // The dummy compare is what keeps this path from being a timing oracle.
      expect(passwordService.compareWithDummy).toHaveBeenCalledWith(loginDto.password);
    });

    it('gives the identical message for unknown email and wrong password', async () => {
      usersService.findByEmailWithSecrets.mockResolvedValue(null);
      const unknown = await service.login(loginDto, CONTEXT).catch((e: Error) => e.message);

      usersService.findByEmailWithSecrets.mockResolvedValue(asUser(buildUserStub()));
      passwordService.compare.mockResolvedValue(false);
      const wrong = await service.login(loginDto, CONTEXT).catch((e: Error) => e.message);

      expect(unknown).toBe(wrong);
      expect(unknown).toBe('Invalid email or password');
    });

    it('counts a failed attempt', async () => {
      const user = buildUserStub();
      usersService.findByEmailWithSecrets.mockResolvedValue(asUser(user));
      passwordService.compare.mockResolvedValue(false);

      await expect(service.login(loginDto, CONTEXT)).rejects.toThrow(UnauthorizedException);

      expect(usersService.registerFailedLogin).toHaveBeenCalledWith(user, 5, 15);
    });

    it('stops counting once the account is already locked', async () => {
      const locked = buildUserStub({ lockedUntil: new Date(Date.now() + 600_000) });
      usersService.findByEmailWithSecrets.mockResolvedValue(asUser(locked));
      passwordService.compare.mockResolvedValue(false);

      await expect(service.login(loginDto, CONTEXT)).rejects.toThrow(UnauthorizedException);

      expect(usersService.registerFailedLogin).not.toHaveBeenCalled();
    });

    it('checks the password BEFORE disclosing that the account is locked', async () => {
      const locked = buildUserStub({ lockedUntil: new Date(Date.now() + 600_000) });
      usersService.findByEmailWithSecrets.mockResolvedValue(asUser(locked));
      passwordService.compare.mockResolvedValue(false);

      // Wrong password on a locked account must look like any other failure —
      // otherwise the endpoint confirms the account exists.
      const error = (await service.login(loginDto, CONTEXT).catch((e: Error) => e)) as Error;

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe('Invalid email or password');
    });

    it('reports the lock only once the password is correct', async () => {
      const locked = buildUserStub({ lockedUntil: new Date(Date.now() + 600_000) });
      usersService.findByEmailWithSecrets.mockResolvedValue(asUser(locked));
      passwordService.compare.mockResolvedValue(true);

      const error = (await service
        .login(loginDto, CONTEXT)
        .catch((e: unknown) => e)) as HttpException;

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(429);
      expect(
        (error.getResponse() as { retryAfterSeconds: number }).retryAfterSeconds,
      ).toBeGreaterThan(0);
      expect(usersService.registerSuccessfulLogin).not.toHaveBeenCalled();
    });

    it('refuses a disabled account even with the right password', async () => {
      const disabled = buildUserStub({ isActive: false });
      usersService.findByEmailWithSecrets.mockResolvedValue(asUser(disabled));
      passwordService.compare.mockResolvedValue(true);

      await expect(service.login(loginDto, CONTEXT)).rejects.toThrow(ForbiddenException);
    });

    it('records the session context for auditing', async () => {
      usersService.findByEmailWithSecrets.mockResolvedValue(asUser(buildUserStub()));
      passwordService.compare.mockResolvedValue(true);

      await service.login(loginDto, CONTEXT);

      expect(refreshTokenModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ userAgent: 'jest', ipAddress: '127.0.0.1' }),
      );
    });
  });

  describe('refresh', () => {
    const rawToken = 'refresh.jwt';

    const arrangeValidToken = (user: UserStub = buildUserStub()): RefreshTokenStub => {
      const stored = buildRefreshTokenStub({
        jti: 'stored-jti',
        userId: user.id,
        tokenHash: Buffer.from(rawToken).toString('hex'),
      });

      tokenService.verifyRefreshToken.mockResolvedValue({
        sub: user.id,
        jti: 'stored-jti',
        type: 'refresh',
        iat: 0,
        exp: 0,
      });
      refreshTokenModel.findOne.mockResolvedValue(asRefreshToken(stored));
      usersService.findActiveById.mockResolvedValue(asUser(user));

      return stored;
    };

    it('rejects a missing token', async () => {
      await expect(service.refresh(undefined, CONTEXT)).rejects.toThrow(UnauthorizedException);
    });

    it('rotates: revokes the presented token and links its successor', async () => {
      const stored = arrangeValidToken();

      await service.refresh(rawToken, CONTEXT);

      expect(stored.update).toHaveBeenCalledWith(
        expect.objectContaining({ replacedByJti: issuedRefresh.jti }),
      );
      expect((stored.update.mock.calls[0][0] as { revokedAt: Date }).revokedAt).toBeInstanceOf(
        Date,
      );
    });

    it('issues a brand new pair', async () => {
      arrangeValidToken();

      const result = await service.refresh(rawToken, CONTEXT);

      expect(result.access.token).toBe(issuedAccess.token);
      expect(refreshTokenModel.create).toHaveBeenCalledTimes(1);
    });

    it('revokes EVERY session when an already-rotated token is replayed', async () => {
      const reused = buildRevokedRefreshTokenStub({ userId: 'user-1' });
      tokenService.verifyRefreshToken.mockResolvedValue({
        sub: 'user-1',
        jti: reused.jti,
        type: 'refresh',
        iat: 0,
        exp: 0,
      });
      refreshTokenModel.findOne.mockResolvedValue(asRefreshToken(reused));

      await expect(service.refresh(rawToken, CONTEXT)).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenModel.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
        { where: { userId: 'user-1', revokedAt: null } },
      );
    });

    it('rejects an expired token', async () => {
      const expired = buildExpiredRefreshTokenStub();
      tokenService.verifyRefreshToken.mockResolvedValue({
        sub: expired.userId,
        jti: expired.jti,
        type: 'refresh',
        iat: 0,
        exp: 0,
      });
      refreshTokenModel.findOne.mockResolvedValue(asRefreshToken(expired));

      await expect(service.refresh(rawToken, CONTEXT)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a correctly-signed token we have no record of', async () => {
      tokenService.verifyRefreshToken.mockResolvedValue({
        sub: 'user-1',
        jti: 'ghost',
        type: 'refresh',
        iat: 0,
        exp: 0,
      });
      refreshTokenModel.findOne.mockResolvedValue(null);

      await expect(service.refresh(rawToken, CONTEXT)).rejects.toThrow(UnauthorizedException);
    });

    it('revokes everything when the stored hash does not match', async () => {
      const tampered = buildRefreshTokenStub({
        userId: 'user-1',
        tokenHash: Buffer.from('different-token').toString('hex'),
      });
      tokenService.verifyRefreshToken.mockResolvedValue({
        sub: 'user-1',
        jti: tampered.jti,
        type: 'refresh',
        iat: 0,
        exp: 0,
      });
      refreshTokenModel.findOne.mockResolvedValue(asRefreshToken(tampered));

      await expect(service.refresh(rawToken, CONTEXT)).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenModel.update).toHaveBeenCalled();
    });

    it('rejects when the user is gone or deactivated', async () => {
      arrangeValidToken();
      usersService.findActiveById.mockResolvedValue(null);

      await expect(service.refresh(rawToken, CONTEXT)).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenModel.update).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the presented session', async () => {
      tokenService.verifyRefreshToken.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        type: 'refresh',
        iat: 0,
        exp: 0,
      });

      await service.logout('refresh.jwt');

      expect(refreshTokenModel.update).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
        { where: { jti: 'jti-1', revokedAt: null } },
      );
    });

    it('is a no-op without a token', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(refreshTokenModel.update).not.toHaveBeenCalled();
    });

    it('swallows an invalid token — logging out still means logged out', async () => {
      tokenService.verifyRefreshToken.mockRejectedValue(new UnauthorizedException());

      await expect(service.logout('garbage')).resolves.toBeUndefined();
    });
  });

  describe('logoutAll', () => {
    it('revokes every live session and reports the count', async () => {
      refreshTokenModel.update.mockResolvedValue([3]);

      await expect(service.logoutAll('user-1')).resolves.toBe(3);
      expect(refreshTokenModel.update).toHaveBeenCalledWith(expect.anything(), {
        where: { userId: 'user-1', revokedAt: null },
      });
    });
  });

  describe('getProfile', () => {
    it('returns the mapped profile', async () => {
      const user = buildUserStub({ email: 'ada@test.io' });
      usersService.findActiveById.mockResolvedValue(asUser(user));

      await expect(service.getProfile(user.id)).resolves.toMatchObject({ email: 'ada@test.io' });
    });

    it('throws when the account is no longer active', async () => {
      usersService.findActiveById.mockResolvedValue(null);

      await expect(service.getProfile('gone')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('pruneExpiredTokens', () => {
    it('deletes expired and revoked rows', async () => {
      refreshTokenModel.destroy.mockResolvedValue(7);

      await expect(service.pruneExpiredTokens()).resolves.toBe(7);
    });
  });
});
