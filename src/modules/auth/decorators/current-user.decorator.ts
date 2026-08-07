import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth.constants';

/**
 * Injects the authenticated principal.
 *
 * ```ts
 * findMine(@CurrentUser() user: AuthenticatedUser) {}
 * findMine(@CurrentUser('id') userId: string) {}
 * ```
 *
 * Only valid on guarded routes — on a `@Public()` route this yields
 * `undefined`, so type it accordingly there.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) return undefined;

    return field ? user[field] : user;
  },
);
