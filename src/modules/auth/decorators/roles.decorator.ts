import { SetMetadata, type CustomDecorator } from '@nestjs/common';

import type { RoleName } from '../../roles/entities/role.entity';

export const ROLES_KEY = 'requiredRoles';

/**
 * Restricts a route (or a whole controller) to the listed roles.
 *
 * Semantics are OR: the caller needs *any one* of them. A method-level
 * `@Roles(...)` overrides the controller-level one rather than intersecting
 * with it, so a controller default can be widened or narrowed per endpoint.
 *
 * ```ts
 * @Roles(RoleName.Admin)                      // admins only
 * @Roles(RoleName.Admin, RoleName.Provider)   // either one
 * ```
 *
 * Requires authentication: `RolesGuard` rejects an unauthenticated request
 * outright rather than treating it as role-less.
 */
export const Roles = (...roles: RoleName[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
