export interface ParsedDatabaseUrl {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/**
 * Connection details from a single URL — the form every managed Postgres hands
 * you, including Railway, Render, Fly, Neon and Supabase.
 *
 * Lives in its own module because both `configuration.ts` (which builds the
 * connection) and `env.validation.ts` (which rejects a broken one at boot)
 * need it, and those two already point at each other.
 *
 * Returns `null` rather than throwing on a bad value, so the env contract can
 * report it alongside every other problem in one message instead of dying with
 * a bare `TypeError` from `new URL`.
 */
export function parseDatabaseUrl(value: string | undefined): ParsedDatabaseUrl | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!/^postgres(ql)?:$/.test(url.protocol)) return null;

    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!url.hostname || !database) return null;

    return {
      host: url.hostname,
      // The URL may omit the port; Postgres' default is the right fallback.
      port: url.port ? Number(url.port) : 5432,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
    };
  } catch {
    return null;
  }
}
