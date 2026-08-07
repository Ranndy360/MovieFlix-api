import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { RoleName } from '../../roles/entities/role.entity';
import { asUser, buildUserStub } from '../../users/testing/user.factory';
import type { UsersService } from '../../users/users.service';
import { TOKEN_TYPE, type AccessTokenPayload } from '../auth.constants';
import { JwtStrategy } from './jwt.strategy';

const AUTH_CONFIG = {
  accessSecret: 'access-secret-that-is-at-least-32-chars',
  issuer: 'movieflix-api',
  audience: 'movieflix-web',
};

const payload = (overrides: Partial<AccessTokenPayload> = {}): AccessTokenPayload => ({
  sub: 'user-1',
  email: 'ada@test.io',
  role: RoleName.User,
  type: TOKEN_TYPE.Access,
  jti: 'jti-1',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
  ...overrides,
});

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: { findActiveById: jest.Mock };

  beforeEach(() => {
    usersService = { findActiveById: jest.fn() };

    strategy = new JwtStrategy(
      { getOrThrow: () => AUTH_CONFIG } as unknown as ConfigService,
      usersService as unknown as UsersService,
    );
  });

  it('resolves the principal for an active user', async () => {
    const user = buildUserStub({ id: 'user-1', email: 'ada@test.io' }, RoleName.Provider);
    usersService.findActiveById.mockResolvedValue(asUser(user));

    await expect(strategy.validate(payload())).resolves.toEqual({
      id: 'user-1',
      email: 'ada@test.io',
      role: RoleName.Provider,
      tokenId: 'jti-1',
    });
  });

  it('takes the role from the DATABASE, not from the token', async () => {
    // Token still says USER, but the account has since been promoted.
    const promoted = buildUserStub({ id: 'user-1' }, RoleName.Admin);
    usersService.findActiveById.mockResolvedValue(asUser(promoted));

    const principal = await strategy.validate(payload({ role: RoleName.User }));

    // A stale role in a signed token must never win — that is what makes a
    // demotion take effect immediately instead of at token expiry.
    expect(principal.role).toBe(RoleName.Admin);
  });

  it('rejects a token for a user who no longer exists or was deactivated', async () => {
    usersService.findActiveById.mockResolvedValue(null);

    await expect(strategy.validate(payload())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a refresh token presented as an access token', async () => {
    await expect(
      strategy.validate(payload({ type: 'refresh' as unknown as typeof TOKEN_TYPE.Access })),
    ).rejects.toThrow(UnauthorizedException);

    expect(usersService.findActiveById).not.toHaveBeenCalled();
  });

  it('rejects a token issued before the last password change', async () => {
    const user = buildUserStub({ id: 'user-1' });
    // Password changed one minute ago…
    user.passwordChangedAt = new Date(Date.now() - 60_000);
    usersService.findActiveById.mockResolvedValue(asUser(user));

    // …but this token was minted an hour ago.
    const stale = payload({ iat: Math.floor((Date.now() - 3_600_000) / 1000) });

    await expect(strategy.validate(stale)).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a token issued after the last password change', async () => {
    const user = buildUserStub({ id: 'user-1' });
    user.passwordChangedAt = new Date(Date.now() - 3_600_000);
    usersService.findActiveById.mockResolvedValue(asUser(user));

    await expect(strategy.validate(payload())).resolves.toMatchObject({ id: 'user-1' });
  });

  it('rejects when the role association failed to load', async () => {
    const user = buildUserStub({ id: 'user-1' });
    (user as { role?: unknown }).role = undefined;
    usersService.findActiveById.mockResolvedValue(asUser(user));

    await expect(strategy.validate(payload())).rejects.toThrow(UnauthorizedException);
  });
});
