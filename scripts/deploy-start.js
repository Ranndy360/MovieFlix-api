#!/usr/bin/env node
/**
 * Release entrypoint: bring the schema up to date, then serve.
 *
 * Exists as a script rather than `db:migrate && node dist/main` for two
 * reasons. It says out loud what it is about to do and against which host, so
 * "the database looks untouched" becomes a question the deploy log can answer.
 * And it starts the API by requiring it *in this process*, so there is no
 * wrapper in the way: a platform's SIGTERM reaches Nest directly and the
 * shutdown hooks run, instead of being reported as `npm error signal SIGTERM`.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Host and port only — never the credentials, which end up in deploy logs. */
function describe(url) {
  if (!url) return '(no URL: falling back to the discrete DB_* variables)';

  try {
    const parsed = new URL(url);
    const pooled = parsed.port === '6543' ? ' [transaction pooler]' : '';
    return `${parsed.hostname}:${parsed.port || '5432'}${pooled}`;
  } catch {
    return '(unparseable URL)';
  }
}

function isTransactionPooler(url) {
  try {
    return new URL(url).port === '6543';
  } catch {
    return false;
  }
}

function run(label, args, env) {
  console.log(`[release] ${label}…`);

  const result = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit', env, shell: false });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`[release] ${label} failed with exit code ${result.status}`);
  }

  console.log(`[release] ${label} done.`);
}

function main() {
  const databaseUrl = process.env.DATABASE_URL;

  console.log(`[release] migrating against ${describe(databaseUrl)}`);

  /*
   * Port 6543 on a Supabase pooler host is PgBouncer in transaction mode: the
   * connection goes back to the pool after every statement. That suits an
   * application and defeats a migration runner, which needs session state and
   * transactions that hold locks across many statements. Same host, port 5432,
   * is session mode and works for both.
   *
   * A warning rather than a refusal — the port is a strong hint, not proof, and
   * a deploy that stops on a guess is worse than one that tells you what it
   * suspects.
   */
  if (databaseUrl && isTransactionPooler(databaseUrl)) {
    console.warn(
      '[release] WARNING: DATABASE_URL points at a transaction pooler (port 6543). ' +
        'If migrations hang or fail, switch it to the session pooler: same host, port 5432.',
    );
  }

  run('migrate', ['sequelize-cli', 'db:migrate'], process.env);

  // Opt-in: seeders are idempotent, but re-running them on every deploy is a
  // decision, not a default. Set RUN_SEED=true for the first deploy.
  if (process.env.RUN_SEED === 'true') {
    run('seed', ['sequelize-cli', 'db:seed:all'], process.env);
  } else {
    console.log('[release] seeding skipped (set RUN_SEED=true to run it).');
  }

  console.log('[release] starting the API.');
  require(path.join(ROOT, 'dist', 'main.js'));
}

main();
