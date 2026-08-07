import {
  type ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import { RoleName } from '../../roles/entities/role.entity';
import type { AuthenticatedUser } from '../auth.constants';
import { RolesGuard } from './roles.guard';

const buildContext = (user?: AuthenticatedUser): ExecutionContext =>
  ({
    getHandler: () => jest.fn(),
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user, method: 'POST', url: '/api/v1/movies' }),
    }),
  }) as unknown as ExecutionContext;

const principal = (role: RoleName): AuthenticatedUser => ({
  id: 'user-1',
  email: 'ada@test.io',
  role,
  tokenId: 'jti-1',
});

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('allows a route with no @Roles metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext(principal(RoleName.User)))).toBe(true);
  });

  it('allows a route whose @Roles list is empty', () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    expect(guard.canActivate(buildContext(principal(RoleName.User)))).toBe(true);
  });

  it('allows the exact required role', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleName.Admin]);

    expect(guard.canActivate(buildContext(principal(RoleName.Admin)))).toBe(true);
  });

  it('treats multiple roles as OR', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleName.Admin, RoleName.Provider]);

    expect(guard.canActivate(buildContext(principal(RoleName.Provider)))).toBe(true);
  });

  it('rejects a role that is not listed', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleName.Admin, RoleName.Provider]);

    expect(() => guard.canActivate(buildContext(principal(RoleName.User)))).toThrow(
      ForbiddenException,
    );
  });

  it('does not let PROVIDER stand in for ADMIN — roles are not a hierarchy', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleName.Admin]);

    expect(() => guard.canActivate(buildContext(principal(RoleName.Provider)))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects an unauthenticated request on a role-restricted route', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleName.Admin]);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(UnauthorizedException);
  });

  it('reads metadata from both the handler and the controller', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleName.Admin]);

    guard.canActivate(buildContext(principal(RoleName.Admin)));

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      'requiredRoles',
      expect.arrayContaining([expect.anything(), expect.anything()]),
    );
  });

  it('logs the denial for auditing', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    reflector.getAllAndOverride.mockReturnValue([RoleName.Admin]);

    expect(() => guard.canActivate(buildContext(principal(RoleName.User)))).toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ada@test.io'));
  });

  it('does not leak the required roles to the caller', () => {
    reflector.getAllAndOverride.mockReturnValue([RoleName.Admin]);

    const error = (() => {
      try {
        guard.canActivate(buildContext(principal(RoleName.User)));
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(error?.message).toBe('You do not have permission to perform this action');
    expect(error?.message).not.toContain('ADMIN');
  });
});
