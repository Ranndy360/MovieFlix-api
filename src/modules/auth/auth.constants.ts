import type { RoleName } from '../roles/entities/role.entity';

/** Cookie names. Prefixed so they cannot collide with anything else on the host. */
export const ACCESS_TOKEN_COOKIE = 'mf_access';
export const REFRESH_TOKEN_COOKIE = 'mf_refresh';

/**
 * The refresh cookie is scoped to the auth routes: the browser then never
 * attaches it to ordinary API calls, shrinking its exposure to exactly the
 * endpoints that need it.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export const TOKEN_TYPE = {
  Access: 'access',
  Refresh: 'refresh',
} as const;

export type TokenType = (typeof TOKEN_TYPE)[keyof typeof TOKEN_TYPE];

/** Shape of a signed access token. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: RoleName;
  type: typeof TOKEN_TYPE.Access;
  jti: string;
  iat: number;
  exp: number;
}

/** Shape of a signed refresh token — deliberately minimal. */
export interface RefreshTokenPayload {
  sub: string;
  type: typeof TOKEN_TYPE.Refresh;
  jti: string;
  iat: number;
  exp: number;
}

/** What lands on `request.user` after the JWT strategy validates. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: RoleName;
  /** `jti` of the access token that authenticated this request. */
  tokenId: string;
}

/**
 * Per-route rate limits for the auth endpoints.
 *
 * `@Throttle()` is evaluated when the class is defined, before any DI
 * container exists, so these read `process.env` directly. That is safe because
 * they are start-up constants — and `env.validation.ts` still validates the
 * values, so a malformed limit fails the boot rather than silently defaulting.
 */
const limitFromEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const AUTH_THROTTLE = {
  /** Signup: generous enough for typos, tight enough to stop bulk creation. */
  register: { limit: limitFromEnv('AUTH_REGISTER_THROTTLE_LIMIT', 5), ttl: 60_000 },
  /** Login: the brute-force budget, on top of per-account lockout. */
  login: { limit: limitFromEnv('AUTH_THROTTLE_LIMIT', 10), ttl: 60_000 },
  /** Refresh: called routinely by every tab, so it needs more headroom. */
  refresh: { limit: limitFromEnv('AUTH_REFRESH_THROTTLE_LIMIT', 30), ttl: 60_000 },
} as const;

/** Metadata captured with each session, for auditing and revocation UX. */
export interface RequestContext {
  userAgent: string | null;
  ipAddress: string | null;
}
