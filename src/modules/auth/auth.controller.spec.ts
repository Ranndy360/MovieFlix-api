import { Test, type TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { seedFaker } from '../../testing/factory';
import { RoleName } from '../roles/entities/role.entity';
import { AuthController } from './auth.controller';
import { AuthService, type AuthResult } from './auth.service';
import { REFRESH_TOKEN_COOKIE } from './auth.constants';
import { AuthCookieService } from './services/auth-cookie.service';

const buildRequest = (cookies: Record<string, string> = {}): Request =>
  ({
    cookies,
    ip: '203.0.113.7',
    get: (header: string) => (header.toLowerCase() === 'user-agent' ? 'jest-agent' : undefined),
  }) as unknown as Request;

const buildResult = (): AuthResult => ({
  user: {
    id: 'user-1',
    email: 'ada@test.io',
    firstName: 'Ada',
    lastName: 'Lovelace',
    fullName: 'Ada Lovelace',
    role: RoleName.User,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
  },
  access: { token: 'access.jwt', jti: 'a', expiresAt: new Date(Date.now() + 900_000) },
  refresh: { token: 'refresh.jwt', jti: 'r', expiresAt: new Date(Date.now() + 604_800_000) },
});

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<
    Pick<AuthService, 'register' | 'login' | 'refresh' | 'logout' | 'logoutAll' | 'getProfile'>
  >;
  let cookieService: jest.Mocked<Pick<AuthCookieService, 'setAuthCookies' | 'clearAuthCookies'>>;
  let response: Response;

  beforeEach(async () => {
    seedFaker();

    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
      logoutAll: jest.fn().mockResolvedValue(2),
      getProfile: jest.fn(),
    };

    cookieService = { setAuthCookies: jest.fn(), clearAuthCookies: jest.fn() };
    response = {} as Response;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuthCookieService, useValue: cookieService },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  const registerDto = {
    email: 'ada@test.io',
    password: 'Str0ng!Passw0rd',
    firstName: 'Ada',
    lastName: 'Lovelace',
  };

  describe('register', () => {
    it('sets the auth cookies', async () => {
      authService.register.mockResolvedValue(buildResult());

      await controller.register(registerDto, buildRequest(), response);

      expect(cookieService.setAuthCookies).toHaveBeenCalledTimes(1);
    });

    it('returns the profile but never a token', async () => {
      authService.register.mockResolvedValue(buildResult());

      const body = await controller.register(registerDto, buildRequest(), response);

      expect(body.user.email).toBe('ada@test.io');
      expect(JSON.stringify(body)).not.toContain('access.jwt');
      expect(JSON.stringify(body)).not.toContain('refresh.jwt');
      expect(body).not.toHaveProperty('accessToken');
    });

    it('reports the remaining lifetime in seconds', async () => {
      authService.register.mockResolvedValue(buildResult());

      const body = await controller.register(registerDto, buildRequest(), response);

      expect(body.expiresIn).toBeGreaterThan(890);
      expect(body.expiresIn).toBeLessThanOrEqual(900);
    });

    it('captures the request context for the session record', async () => {
      authService.register.mockResolvedValue(buildResult());

      await controller.register(registerDto, buildRequest(), response);

      expect(authService.register).toHaveBeenCalledWith(registerDto, {
        userAgent: 'jest-agent',
        ipAddress: '203.0.113.7',
      });
    });
  });

  describe('login', () => {
    it('sets cookies and returns the profile', async () => {
      authService.login.mockResolvedValue(buildResult());

      const body = await controller.login(
        { email: 'ada@test.io', password: 'x' },
        buildRequest(),
        response,
      );

      expect(cookieService.setAuthCookies).toHaveBeenCalled();
      expect(body.user.role).toBe(RoleName.User);
    });

    it('lets a credential failure propagate', async () => {
      authService.login.mockRejectedValue(new Error('Invalid email or password'));

      await expect(
        controller.login({ email: 'a@b.io', password: 'x' }, buildRequest(), response),
      ).rejects.toThrow();
      expect(cookieService.setAuthCookies).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('reads the refresh token from its cookie', async () => {
      authService.refresh.mockResolvedValue(buildResult());

      await controller.refresh(buildRequest({ [REFRESH_TOKEN_COOKIE]: 'refresh.jwt' }), response);

      expect(authService.refresh).toHaveBeenCalledWith('refresh.jwt', expect.anything());
    });

    it('passes undefined when the cookie is absent', async () => {
      authService.refresh.mockResolvedValue(buildResult());

      await controller.refresh(buildRequest(), response);

      expect(authService.refresh).toHaveBeenCalledWith(undefined, expect.anything());
    });

    it('clears the cookies when the session is dead', async () => {
      authService.refresh.mockRejectedValue(new Error('Invalid or expired session'));

      await expect(controller.refresh(buildRequest(), response)).rejects.toThrow();

      // Otherwise the client keeps retrying with a token that can never work.
      expect(cookieService.clearAuthCookies).toHaveBeenCalledWith(response);
    });
  });

  describe('logout', () => {
    it('revokes the session and clears the cookies', async () => {
      const body = await controller.logout(
        buildRequest({ [REFRESH_TOKEN_COOKIE]: 'refresh.jwt' }),
        response,
      );

      expect(authService.logout).toHaveBeenCalledWith('refresh.jwt');
      expect(cookieService.clearAuthCookies).toHaveBeenCalledWith(response);
      expect(body.message).toBe('Signed out');
    });

    it('still clears the cookies with no token present', async () => {
      await controller.logout(buildRequest(), response);

      expect(cookieService.clearAuthCookies).toHaveBeenCalled();
    });
  });

  describe('logoutAll', () => {
    it('reports how many sessions ended', async () => {
      const body = await controller.logoutAll('user-1', response);

      expect(authService.logoutAll).toHaveBeenCalledWith('user-1');
      expect(body.message).toContain('2');
      expect(cookieService.clearAuthCookies).toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('returns the profile for the authenticated id', async () => {
      const { user } = buildResult();
      authService.getProfile.mockResolvedValue(user);

      await expect(controller.me('user-1')).resolves.toBe(user);
      expect(authService.getProfile).toHaveBeenCalledWith('user-1');
    });
  });
});
