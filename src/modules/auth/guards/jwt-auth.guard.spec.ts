import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import { JwtAuthGuard } from './jwt-auth.guard';

const buildContext = (): ExecutionContext =>
  ({
    getHandler: () => jest.fn(),
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
  });

  it('lets a @Public() route through without touching passport', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('delegates to passport when the route is not public', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const parent = jest
      .spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: () => boolean },
        'canActivate',
      )
      .mockReturnValue(true);

    expect(guard.canActivate(buildContext())).toBe(true);
    expect(parent).toHaveBeenCalled();
  });

  it('defaults to protected when no metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const parent = jest
      .spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: () => boolean },
        'canActivate',
      )
      .mockReturnValue(true);

    void guard.canActivate(buildContext());

    expect(parent).toHaveBeenCalled();
  });

  describe('handleRequest', () => {
    it('returns the principal on success', () => {
      const user = { id: 'user-1' };

      expect(guard.handleRequest(null, user)).toBe(user);
    });

    it('throws a generic 401 when passport reports an error', () => {
      expect(() => guard.handleRequest(new Error('jwt expired'), null)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws a generic 401 when there is no user', () => {
      expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
    });

    it('never discloses why the token failed', () => {
      const error = (() => {
        try {
          guard.handleRequest(new Error('jwt malformed'), null);
          return null;
        } catch (e) {
          return e as Error;
        }
      })();

      expect(error?.message).toBe('Authentication required');
      expect(error?.message).not.toContain('malformed');
    });
  });
});
