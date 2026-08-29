#!/usr/bin/env node
/**
 * Bring a database up to date, from empty or from a previous version.
 *
 * 1. Waits for PostgreSQL to accept connections.
 * 2. Pushes the Drizzle schema (lib/db/src/schema).
 * 3. Applies the hand-written SQL migrations in artifacts/api-server/migrations,
 *    which are idempotent and safe to re-run.
 *
 * Usage: DATABASE_URL=postgresql://... node scripts/migrate.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL must be set.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDatabase({ attempts = 30, delayMs = 1000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const client = new pg.Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.end();
      console.log('Database is accepting connections.');
      return;
    } catch {
      await client.end().catch(() => {});
      if (i === attempts) {
        throw new Error(`Database unreachable after ${attempts} attempts.`);
      }
      await sleep(delayMs);
    }
  }
}

function pushDrizzleSchema() {
  console.log('Pushing Drizzle schema...');
  // Schema and url are passed explicitly rather than via drizzle.config.ts:
  // the config resolves its schema path with __dirname, which breaks when the
  // project lives under a path containing non-ASCII characters.
  const output = execFileSync(
    'pnpm',
    [
      '--filter', '@workspace/db', 'exec', 'drizzle-kit', 'push',
      '--force',
      '--dialect=postgresql',
      '--schema=./src/schema/index.ts',
      `--url=${databaseUrl}`,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  );

  process.stdout.write(output);

  // drizzle-kit exits 0 even when the push fails — notably when a structural
  // change (dropping a NOT NULL, renaming a column) triggers an interactive
  // confirmation that cannot be answered without a TTY. Trusting the exit code
  // alone lets the schema silently drift from the code. Scan the output too.
  if (/Interactive prompts require a TTY|^Error:/m.test(output)) {
    throw new Error(
      'drizzle-kit push did not complete: it needs an interactive prompt for a ' +
        'structural change (exit code 0 is not trustworthy here). Express that ' +
        'change as a SQL file in artifacts/api-server/migrations instead.',
    );
  }
}

async function applySqlMigrations() {
  const dir = path.join(root, 'artifacts', 'api-server', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.log('No SQL migrations to apply.');
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const file of files) {
      console.log(`Applying ${file}...`);
      await client.query(readFileSync(path.join(dir, file), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

await waitForDatabase();
pushDrizzleSchema();
await applySqlMigrations();
console.log('Migrations complete.');
