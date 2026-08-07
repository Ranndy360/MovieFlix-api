import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';

import { RoleName } from '../../roles/entities/role.entity';
import { TokenService } from './token.service';

const AUTH_CONFIG = {
  accessSecret: 'access-secret-that-is-at-least-32-chars',
  accessTtl: '15m',
  refreshSecret: 'refresh-secret-that-is-at-least-32-chars',
  refreshTtl: '7d',
  issuer: 'movieflix-api',
  audience: 'movieflix-web',
  bcryptRounds: 12,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

const SUBJECT = { id: 'user-1', email: 'ada@test.io', role: RoleName.Provider };

/** Uses a real JwtService — the point is that the tokens actually verify. */
describe('TokenService', () => {
  let service: TokenService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        TokenService,
        { provide: ConfigService, useValue: { getOrThrow: () => AUTH_CONFIG } },
      ],
    }).compile();

    service = moduleRef.get(TokenService);
    jwtService = moduleRef.get(JwtService);
  });

  describe('issueAccessToken', () => {
    it('embeds the identity claims', async () => {
      const { token } = await service.issueAccessToken(SUBJECT);
      const payload = jwtService.decode(token);

      expect(payload).toMatchObject({
        sub: 'user-1',
        email: 'ada@test.io',
        role: RoleName.Provider,
        type: 'access',
        iss: 'movieflix-api',
        aud: 'movieflix-web',
      });
    });

    it('returns a unique jti per call', async () => {
      const first = await service.issueAccessToken(SUBJECT);
      const second = await service.issueAccessToken(SUBJECT);

      expect(first.jti).not.toBe(second.jti);
    });

    it('reports an expiry roughly one TTL out', async () => {
      const { expiresAt } = await service.issueAccessToken(SUBJECT);
      const deltaMinutes = (expiresAt.getTime() - Date.now()) / 60_000;

      expect(deltaMinutes).toBeGreaterThan(14);
      expect(deltaMinutes).toBeLessThanOrEqual(15);
    });
  });

  describe('issueRefreshToken', () => {
    it('carries only the subject — no email or role', async () => {
      const { token } = await service.issueRefreshToken('user-1');
      const payload = jwtService.decode(token);

      expect(payload).toMatchObject({ sub: 'user-1', type: 'refresh' });
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('role');
    });

    it('lives much longer than an access token', async () => {
      const access = await service.issueAccessToken(SUBJECT);
      const refresh = await service.issueRefreshToken('user-1');

      expect(refresh.expiresAt.getTime()).toBeGreaterThan(access.expiresAt.getTime());
    });
  });

  describe('verifyRefreshToken', () => {
    it('accepts a token it just issued', async () => {
      const { token, jti } = await service.issueRefreshToken('user-1');

      await expect(service.verifyRefreshToken(token)).resolves.toMatchObject({
        sub: 'user-1',
        jti,
        type: 'refresh',
      });
    });

    it('rejects an access token presented as a refresh token', async () => {
      const { token } = await service.issueAccessToken(SUBJECT);

      // Signed with the *access* secret, so this fails at signature check —
      // the separate secrets are what make the swap impossible.
      await expect(service.verifyRefreshToken(token)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const forged = await jwtService.signAsync(
        { sub: 'user-1', type: 'refresh' },
        { secret: 'a-completely-different-secret-value-32', jwtid: 'x', expiresIn: '7d' },
      );

      await expect(service.verifyRefreshToken(forged)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      const expired = await jwtService.signAsync(
        { sub: 'user-1', type: 'refresh' },
        {
          secret: AUTH_CONFIG.refreshSecret,
          issuer: AUTH_CONFIG.issuer,
          audience: AUTH_CONFIG.audience,
          jwtid: 'x',
          expiresIn: '-1s',
        },
      );

      await expect(service.verifyRefreshToken(expired)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token minted for a different audience', async () => {
      const wrongAudience = await jwtService.signAsync(
        { sub: 'user-1', type: 'refresh' },
        {
          secret: AUTH_CONFIG.refreshSecret,
          issuer: AUTH_CONFIG.issuer,
          audience: 'someone-else',
          jwtid: 'x',
          expiresIn: '7d',
        },
      );

      await expect(service.verifyRefreshToken(wrongAudience)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a refresh token whose type claim was tampered with', async () => {
      const wrongType = await jwtService.signAsync(
        { sub: 'user-1', type: 'access' },
        {
          secret: AUTH_CONFIG.refreshSecret,
          issuer: AUTH_CONFIG.issuer,
          audience: AUTH_CONFIG.audience,
          jwtid: 'x',
          expiresIn: '7d',
        },
      );

      await expect(service.verifyRefreshToken(wrongType)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects outright garbage', async () => {
      await expect(service.verifyRefreshToken('not-a-jwt')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('hashToken', () => {
    it('is deterministic', () => {
      expect(service.hashToken('abc')).toBe(service.hashToken('abc'));
    });

    it('produces a 64-char sha256 hex digest', () => {
      expect(service.hashToken('abc')).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does not contain the original token', async () => {
      const { token } = await service.issueRefreshToken('user-1');

      expect(service.hashToken(token)).not.toContain(token.slice(0, 20));
    });

    it('differs for different inputs', () => {
      expect(service.hashToken('a')).not.toBe(service.hashToken('b'));
    });
  });
});
