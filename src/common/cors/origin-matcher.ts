/**
 * Origin matching for the CORS allow-list.
 *
 * The `cors` package compares an array of origins with `===`, which is exact,
 * case-sensitive and unforgiving. Two things routinely break it, and neither
 * announces itself — the browser just reports that the preflight failed:
 *
 * - a trailing slash, because a URL copied out of a hosting dashboard has one
 *   and `https://app.example.com/` never equals `https://app.example.com`;
 * - preview deployments, which get a fresh hostname per branch or per commit,
 *   so no fixed list can cover them.
 *
 * Hence normalisation, and hence a `*` wildcard for the label of a host.
 */

/** Lower-cased, without a trailing slash or any path. */
export function normalizeOrigin(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    // `new URL` throws on anything that is not absolute, which is exactly the
    // input we want to reject rather than half-accept.
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/**
 * A pattern may name one origin (`https://app.example.com`) or use `*` for a
 * single host label (`https://*.vercel.app`).
 *
 * The wildcard stops at a dot on purpose: `https://*.vercel.app` matches
 * `https://mine-git-main.vercel.app` but not `https://evil.attacker.vercel.app`
 * — and never a different scheme, since the scheme is matched literally.
 */
function toMatcher(pattern: string): (origin: string) => boolean {
  const normalized = normalizeOrigin(pattern);
  if (!normalized.includes('*')) return (origin) => origin === normalized;

  const source = normalized
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^.]+');

  const regex = new RegExp(`^${source}$`);
  return (origin) => regex.test(origin);
}

export function isOriginAllowed(origin: string, patterns: readonly string[]): boolean {
  const candidate = normalizeOrigin(origin);
  if (!candidate) return false;

  return patterns.some((pattern) => toMatcher(pattern)(candidate));
}
