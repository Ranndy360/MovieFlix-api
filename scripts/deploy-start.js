#!/usr/bin/env node
/**
 * Release entrypoint: bring the schema up to date, then serve.
 *
 * Exists as a script rather than `db:migrate && node dist/main` for three
 * reasons. It says out loud what it is about to do and against which host, so
 * "the database looks untouched" becomes a question the deploy log can answer.
 * It refuses to let a migration hold the deploy hostage. And it starts the API
 * by requiring it *in this process*, so a platform's SIGTERM reaches Nest
 * directly and the shutdown hooks run, instead of surfacing as
 * `npm error signal SIGTERM` from a wrapper that was in the way.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** A migration that cannot finish must not become a deploy that never starts. */
const MIGRATION_TIMEOUT_MS = Number(process.env.MIGRATION_TIMEOUT_MS ?? 120_000);

/** Host and port only — never the credentials, which end up in deploy logs. */
function describe(url) {
  if (!url) return '(no URL: falling back to the discrete DB_* variables)';

  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}`;
  } catch {
    return '(unparseable URL)';
  }
}

/**
 * Rewrites a Supabase transaction-pooler URL to the session pooler.
 *
 * Port 6543 on a `*.pooler.supabase.com` host is PgBouncer in transaction mode:
 * the connection returns to the pool after every statement. An application is
 * happy with that; a migration runner is not, because it needs session state
 * and transactions that hold locks across many statements. Point `sequelize-cli`
 * at 6543 and it does not fail — it *hangs*, until the platform gives up on the
 * deploy. Port 5432 on the same host is session mode and behaves normally.
 *
 * Doing this automatically rather than asking for a second variable: the
 * mapping is fixed and documented by Supabase, it is the same host and the same
 * credentials, and it only ever applies to their pooler hostnames. Everything
 * else is passed through untouched.
 */
function migrationUrlFor(url) {
  if (!url) return { url, rewritten: false };

  try {
    const parsed = new URL(url);
    const isSupabasePooler = parsed.hostname.endsWith('.pooler.supabase.com');

    if (!isSupabasePooler || parsed.port !== '6543') return { url, rewritten: false };

    parsed.port = '5432';
    return { url: parsed.toString(), rewritten: true };
  } catch {
    return { url, rewritten: false };
  }
}

/** Runs a step, bounded in time. Returns whether it succeeded. */
function run(label, args, env) {
  console.log(`[release] ${label}…`);

  const result = spawnSync('npx', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env,
    shell: false,
    timeout: MIGRATION_TIMEOUT_MS,
  });

  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
    console.error(
      `[release] ${label} did not finish within ${MIGRATION_TIMEOUT_MS}ms and was stopped. ` +
        'The usual cause is a connection that cannot support it — see the host logged above.',
    );
    return false;
  }

  if (result.error) {
    console.error(`[release] ${label} could not run: ${result.error.message}`);
    return false;
  }

  if (result.status !== 0) {
    console.error(`[release] ${label} failed with exit code ${result.status}.`);
    return false;
  }

  console.log(`[release] ${label} done.`);
  return true;
}

function main() {
  const { url: migrationUrl, rewritten } = migrationUrlFor(process.env.DATABASE_URL);

  if (rewritten) {
    console.log(
      '[release] DATABASE_URL is the Supabase transaction pooler (6543); ' +
        'migrating over the session pooler (5432) on the same host instead.',
    );
  }

  console.log(`[release] migrating against ${describe(migrationUrl)}`);

  const env = { ...process.env, ...(migrationUrl ? { DATABASE_URL: migrationUrl } : {}) };

  let ok = run('migrate', ['sequelize-cli', 'db:migrate'], env);

  // Opt-in: the seeders are idempotent, but re-running them on every deploy
  // should be a decision rather than a side effect. Set RUN_SEED=true once.
  if (ok && process.env.RUN_SEED === 'true') {
    ok = run('seed', ['sequelize-cli', 'db:seed:all'], env);
  } else if (ok) {
    console.log('[release] seeding skipped (set RUN_SEED=true to run it).');
  }

  if (!ok) {
    /*
     * Start anyway, loudly.
     *
     * Exiting here is the tidier-looking choice and the worse one: the platform
     * restarts the container, the restart fails the same way, and the deploy
     * ends as a timeout with the reason buried. A process that boots and serves
     * its health check is one you can reach, read logs from, and fix. Requests
     * that need a missing table will fail — visibly, and with a real error.
     */
    console.error(
      '[release] Continuing to start the API despite the failure above. ' +
        'The schema may be incomplete; fix the database connection and redeploy.',
    );
  }

  console.log('[release] starting the API.');
  require(path.join(ROOT, 'dist', 'main.js'));
}

main();
