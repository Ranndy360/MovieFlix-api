import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of the globally-registered `JwtAuthGuard`.
 *
 * Authentication is deny-by-default: every endpoint requires a valid access
 * token unless it is explicitly marked public. Forgetting this decorator makes
 * a route private, which is the safe direction to fail.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
