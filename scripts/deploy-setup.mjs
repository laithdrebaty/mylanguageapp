#!/usr/bin/env node
/**
 * One-time setup for the free deployment (Neon + Render + Vercel).
 * See docs/DEPLOY-FREE.md for the whole walkthrough.
 *
 * 1. Creates the schema and baseline data in the production database
 *    (migrate.mjs, then seed.mjs — both idempotent, safe to re-run).
 * 2. Points the /api rewrite in vercel.json at the Render API.
 *
 * Usage: pnpm run deploy:setup
 * Either step can be skipped by leaving its prompt empty. DATABASE_URL and
 * API_URL in the environment are used instead of prompting.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rl = createInterface({ input: process.stdin });
// An iterator buffers lines, so piped answers are not lost the way they are
// with rl.question() when input arrives before the prompt.
const lines = rl[Symbol.asyncIterator]();

async function ask(question, fromEnv) {
  if (fromEnv) return fromEnv.trim();
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? '' : value.trim();
}

function run(script, env) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed (exit ${result.status}).`);
  }
}

// ── 1. Database ─────────────────────────────────────────────────────────────
console.log('\n[1/2] Production database');
const databaseUrl = await ask(
  'Neon connection string (postgresql://...), or empty to skip: ',
  process.env.DATABASE_URL,
);

if (databaseUrl) {
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error('That does not look like a PostgreSQL connection string.');
  }
  // Neon's "-pooler" host goes through PgBouncer in transaction mode, which is
  // right for the running API but not for schema changes. Migrate over the
  // direct host; Render keeps whichever string it was given.
  const directUrl = databaseUrl.replace(/-pooler\./, '.');
  if (directUrl !== databaseUrl) console.log('Using the direct (non-pooled) host for migrations.');
  run('migrate.mjs', { DATABASE_URL: directUrl });
  run('seed.mjs', { DATABASE_URL: directUrl });
  console.log('Database ready.');
} else {
  console.log('Skipped.');
}

// ── 2. vercel.json ──────────────────────────────────────────────────────────
console.log('\n[2/2] Vercel → Render proxy');
const apiInput = await ask(
  'Render API URL (https://<name>.onrender.com), or empty to skip: ',
  process.env.API_URL,
);

if (apiInput) {
  const apiUrl = new URL(apiInput.includes('://') ? apiInput : `https://${apiInput}`);
  const vercelPath = path.join(root, 'vercel.json');
  const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
  const rewrite = vercel.rewrites?.find((r) => r.source === '/api/:path*');
  if (!rewrite) throw new Error('vercel.json has no /api/:path* rewrite to update.');

  rewrite.destination = `${apiUrl.origin}/api/:path*`;
  writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`);
  console.log(`vercel.json now proxies /api to ${apiUrl.origin}`);
  console.log('Commit and push it; Vercel redeploys on push.');
  console.log(`\nKeep-awake ping URL (cron-job.org, every 10 min):\n  ${apiUrl.origin}/api/healthz`);
} else {
  console.log('Skipped.');
}

rl.close();
console.log('\nDone. Remaining steps: docs/DEPLOY-FREE.md');
