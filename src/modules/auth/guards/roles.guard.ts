import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { RoleName } from '../../roles/entities/role.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Global authorization guard, paired with `@Roles(...)`.
 *
 * Registered as an `APP_GUARD` *after* `JwtAuthGuard`, so by the time it runs
 * `request.user` is either populated or the route is public. A route with no
 * `@Roles(...)` is allowed through — authentication alone is enough.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    // A role-restricted route that somehow ran without authentication is a
    // configuration bug — refuse rather than guess.
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!requiredRoles.includes(user.role)) {
      this.logger.warn(
        `Denied ${request.method} ${request.url} for ${user.email} (role ${user.role}); requires ${requiredRoles.join(' | ')}`,
      );
      throw new ForbiddenException('You do not have permission to perform this action');
    }

    return true;
  }
}
