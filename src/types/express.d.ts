import type { AuthenticatedUser } from '../modules/auth/auth.constants';

/**
 * Types `request.user` as our principal instead of passport's default `{}`,
 * so `@CurrentUser()` and the guards are type-safe end to end.
 */
declare global {
  /* eslint-disable @typescript-eslint/no-empty-object-type */
  namespace Express {
    interface User extends AuthenticatedUser {}
  }
  /* eslint-enable @typescript-eslint/no-empty-object-type */
}

export {};
